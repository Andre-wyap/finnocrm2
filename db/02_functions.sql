-- Phase 1 — Helper functions and triggers
-- Run as superuser / table owner.

-- ─── Helper: resolve current user from session setting ────────────────────────

CREATE OR REPLACE FUNCTION current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  SET search_path = public, pg_temp
AS $$
  SELECT current_setting('app.current_user_id', true)::uuid
$$;

-- ─── Helper: current user's role (SECURITY DEFINER so it can read profiles) ───

CREATE OR REPLACE FUNCTION current_user_role() RETURNS role
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT role FROM profiles WHERE id = current_user_id()
$$;

-- ─── Helper: current user's team_id ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION current_user_team() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT team_id FROM profiles WHERE id = current_user_id()
$$;

-- ─── Trigger: auto-update leads.updated_at ────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
  RETURNS trigger LANGUAGE plpgsql
  SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── Trigger: audit log for lead field / status changes ───────────────────────
-- Writes field_change or status_change to activities on every UPDATE.
-- Excludes assignment fields (assigned_agent_id, assigned_by, assigned_at)
-- because the assignment flow logs an explicit 'assignment' activity.

CREATE OR REPLACE FUNCTION log_lead_changes()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := current_user_id();
BEGIN
  -- status change
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO activities(lead_id, user_id, type, content, old_value, new_value)
    VALUES (NEW.id, v_user_id, 'status_change',
            'Status changed',
            OLD.status::text, NEW.status::text);
  END IF;

  -- field changes — check each customer field individually
  IF NEW.full_name IS DISTINCT FROM OLD.full_name THEN
    INSERT INTO activities(lead_id, user_id, type, field_name, old_value, new_value)
    VALUES (NEW.id, v_user_id, 'field_change', 'full_name', OLD.full_name, NEW.full_name);
  END IF;

  IF NEW.date_of_birth IS DISTINCT FROM OLD.date_of_birth THEN
    INSERT INTO activities(lead_id, user_id, type, field_name, old_value, new_value)
    VALUES (NEW.id, v_user_id, 'field_change', 'date_of_birth',
            OLD.date_of_birth::text, NEW.date_of_birth::text);
  END IF;

  IF NEW.gender IS DISTINCT FROM OLD.gender THEN
    INSERT INTO activities(lead_id, user_id, type, field_name, old_value, new_value)
    VALUES (NEW.id, v_user_id, 'field_change', 'gender', OLD.gender::text, NEW.gender::text);
  END IF;

  IF NEW.smoking_status IS DISTINCT FROM OLD.smoking_status THEN
    INSERT INTO activities(lead_id, user_id, type, field_name, old_value, new_value)
    VALUES (NEW.id, v_user_id, 'field_change', 'smoking_status',
            OLD.smoking_status::text, NEW.smoking_status::text);
  END IF;

  IF NEW.mobile IS DISTINCT FROM OLD.mobile THEN
    INSERT INTO activities(lead_id, user_id, type, field_name, old_value, new_value)
    VALUES (NEW.id, v_user_id, 'field_change', 'mobile', OLD.mobile, NEW.mobile);
  END IF;

  IF NEW.email IS DISTINCT FROM OLD.email THEN
    INSERT INTO activities(lead_id, user_id, type, field_name, old_value, new_value)
    VALUES (NEW.id, v_user_id, 'field_change', 'email', OLD.email, NEW.email);
  END IF;

  IF NEW.state IS DISTINCT FROM OLD.state THEN
    INSERT INTO activities(lead_id, user_id, type, field_name, old_value, new_value)
    VALUES (NEW.id, v_user_id, 'field_change', 'state', OLD.state, NEW.state);
  END IF;

  IF NEW.product_interest IS DISTINCT FROM OLD.product_interest THEN
    INSERT INTO activities(lead_id, user_id, type, field_name, old_value, new_value)
    VALUES (NEW.id, v_user_id, 'field_change', 'product_interest',
            array_to_string(OLD.product_interest, ', '),
            array_to_string(NEW.product_interest, ', '));
  END IF;

  IF NEW.case_size IS DISTINCT FROM OLD.case_size THEN
    INSERT INTO activities(lead_id, user_id, type, field_name, old_value, new_value)
    VALUES (NEW.id, v_user_id, 'field_change', 'case_size',
            OLD.case_size::text, NEW.case_size::text);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER leads_audit
  AFTER UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION log_lead_changes();

-- ─── Bootstrap: resolve profile by firebase_uid (bypasses RLS) ───────────────
-- The app must call this once per request to obtain the internal profiles.id
-- before it can SET LOCAL app.current_user_id. Without this, the profiles RLS
-- policy blocks the lookup because current_user_id() is not yet set (circular
-- dependency). SECURITY DEFINER runs as the function owner (postgres superuser)
-- which bypasses FORCE ROW LEVEL SECURITY safely — the only input is the
-- firebase_uid extracted from a verified Firebase JWT, so there is no
-- enumeration risk.
CREATE OR REPLACE FUNCTION get_profile_by_firebase_uid(p_uid text)
  RETURNS TABLE (id uuid, full_name text, email text, role role, team_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT id, full_name, email, role, team_id
  FROM profiles
  WHERE firebase_uid = p_uid
    AND is_active = true
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION get_profile_by_firebase_uid(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_profile_by_firebase_uid(text) TO app_user;

-- ─── Helper: role of an arbitrary profile id (bypasses profiles RLS) ─────────
-- Used by the leads RLS policy to hide leads assigned to another subadmin or an
-- admin from a subadmin, without reaching through a second RLS layer.
CREATE OR REPLACE FUNCTION role_of(p_id uuid) RETURNS role
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT role FROM profiles WHERE id = p_id
$$;

REVOKE ALL ON FUNCTION role_of(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION role_of(uuid) TO app_user;

-- ─── Assignment picker: role-aware assignable users ──────────────────────────
-- Drives the agent picker, single/bulk assign target validation, and the
-- Reporting users filter (all just SELECT * FROM this). team_leader only
-- sees their own team's active users; subadmin/admin see everyone; agent
-- gets nothing back (agents are already 403'd before this is ever called).
CREATE OR REPLACE FUNCTION get_assignable_users()
  RETURNS TABLE (id uuid, full_name text, role role, team_id uuid, team_name text)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT p.id, p.full_name, p.role, p.team_id, t.name AS team_name
  FROM profiles p
  LEFT JOIN teams t ON t.id = p.team_id
  WHERE p.is_active = true
    AND (
      current_user_role() IN ('subadmin', 'admin')
      OR (current_user_role() = 'team_leader' AND p.team_id = current_user_team())
    )
  ORDER BY p.full_name;
$$;

REVOKE ALL ON FUNCTION get_assignable_users() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_assignable_users() TO app_user;

-- ─── Reporting breakdowns (agent / team / source) ────────────────────────────
-- p_scope_team_id is the caller's mandatory boundary (NULL for subadmin/admin,
-- the team leader's own team_id for team_leader) — separate from the existing
-- p_team_id/p_source/p_product params, which stay optional UI filters a
-- subadmin/admin can additionally apply on top. Both scope and filter check
-- the lead's own team_id (not the assignee's live profile team_id), since a
-- lead's owning team should be credited by where it currently belongs, which
-- can drift from an agent's current team over time.
CREATE OR REPLACE FUNCTION get_reporting_agents(
  p_scope_team_id uuid DEFAULT NULL,
  p_product       text DEFAULT NULL,
  p_team_id       uuid DEFAULT NULL,
  p_source        text DEFAULT NULL
)
RETURNS TABLE (
  user_id         uuid,
  user_name       text,
  team_name       text,
  total_count     bigint,
  lead_count      bigint,
  approach_count  bigint,
  follow_up_count bigint,
  potential_count bigint,
  closed_count    bigint,
  issued_count    bigint,
  case_size       numeric
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    p.id                                                                           AS user_id,
    p.full_name                                                                    AS user_name,
    t.name                                                                         AS team_name,
    COUNT(l.id) FILTER (WHERE l.status NOT IN ('lost','unassigned'))::bigint       AS total_count,
    COUNT(l.id) FILTER (WHERE l.status = 'lead')::bigint                           AS lead_count,
    COUNT(l.id) FILTER (WHERE l.status = 'approach')::bigint                       AS approach_count,
    COUNT(l.id) FILTER (WHERE l.status = 'follow_up')::bigint                      AS follow_up_count,
    COUNT(l.id) FILTER (WHERE l.status = 'potential')::bigint                      AS potential_count,
    COUNT(l.id) FILTER (WHERE l.status = 'closed')::bigint                         AS closed_count,
    COUNT(l.id) FILTER (WHERE l.status = 'issued')::bigint                         AS issued_count,
    COALESCE(SUM(l.case_size) FILTER (WHERE l.status NOT IN ('lost','unassigned')), 0)::numeric
                                                                                   AS case_size
  FROM leads l
  JOIN  profiles p ON p.id = l.assigned_agent_id
  LEFT JOIN teams t ON t.id = p.team_id
  WHERE l.status NOT IN ('unassigned','lost')
    AND l.archived_at IS NULL
    AND (p_product       IS NULL OR p_product::product = ANY(l.product_interest))
    AND (p_scope_team_id IS NULL OR l.team_id = p_scope_team_id)
    AND (p_team_id       IS NULL OR l.team_id = p_team_id)
    AND (p_source        IS NULL OR l.source  = p_source)
  GROUP BY p.id, p.full_name, t.name
  ORDER BY total_count DESC;
$$;

CREATE OR REPLACE FUNCTION get_reporting_teams(
  p_scope_team_id uuid DEFAULT NULL,
  p_product       text DEFAULT NULL,
  p_source        text DEFAULT NULL
)
RETURNS TABLE (
  team_id     uuid,
  team_name   text,
  total_count bigint,
  case_size   numeric
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    t.id                                                                           AS team_id,
    t.name                                                                         AS team_name,
    COUNT(l.id) FILTER (WHERE l.status NOT IN ('lost','unassigned'))::bigint       AS total_count,
    COALESCE(SUM(l.case_size) FILTER (WHERE l.status NOT IN ('lost','unassigned')), 0)::numeric
                                                                                   AS case_size
  FROM leads l
  LEFT JOIN teams t ON t.id = l.team_id
  WHERE l.status NOT IN ('unassigned','lost')
    AND l.archived_at IS NULL
    AND (p_product       IS NULL OR p_product::product = ANY(l.product_interest))
    AND (p_scope_team_id IS NULL OR l.team_id = p_scope_team_id)
    AND (p_source        IS NULL OR l.source  = p_source)
  GROUP BY t.id, t.name
  ORDER BY total_count DESC;
$$;

CREATE OR REPLACE FUNCTION get_reporting_sources(
  p_scope_team_id uuid DEFAULT NULL,
  p_product       text DEFAULT NULL,
  p_team_id       uuid DEFAULT NULL
)
RETURNS TABLE (
  source      text,
  total_count bigint,
  case_size   numeric
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    l.source,
    COUNT(l.id) FILTER (WHERE l.status NOT IN ('lost','unassigned'))::bigint       AS total_count,
    COALESCE(SUM(l.case_size) FILTER (WHERE l.status NOT IN ('lost','unassigned')), 0)::numeric
                                                                                   AS case_size
  FROM leads l
  WHERE l.source IS NOT NULL
    AND l.status NOT IN ('unassigned','lost')
    AND l.archived_at IS NULL
    AND (p_product       IS NULL OR p_product::product = ANY(l.product_interest))
    AND (p_scope_team_id IS NULL OR l.team_id = p_scope_team_id)
    AND (p_team_id       IS NULL OR l.team_id = p_team_id)
  GROUP BY l.source
  ORDER BY total_count DESC;
$$;

REVOKE ALL ON FUNCTION current_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION current_user_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION current_user_team() FROM PUBLIC;
REVOKE ALL ON FUNCTION set_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION log_lead_changes() FROM PUBLIC;
REVOKE ALL ON FUNCTION get_reporting_agents(uuid, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_reporting_teams(uuid, text, text)        FROM PUBLIC;
REVOKE ALL ON FUNCTION get_reporting_sources(uuid, text, uuid)      FROM PUBLIC;

GRANT EXECUTE ON FUNCTION current_user_id() TO app_user;
GRANT EXECUTE ON FUNCTION current_user_role() TO app_user;
GRANT EXECUTE ON FUNCTION current_user_team() TO app_user;
GRANT EXECUTE ON FUNCTION get_reporting_agents(uuid, text, uuid, text) TO app_user;
GRANT EXECUTE ON FUNCTION get_reporting_teams(uuid, text, text)        TO app_user;
GRANT EXECUTE ON FUNCTION get_reporting_sources(uuid, text, uuid)      TO app_user;
