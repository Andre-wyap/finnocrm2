-- Phase 1 — Helper functions and triggers
-- Run as superuser / table owner.

-- ─── Helper: resolve current user from session setting ────────────────────────

CREATE OR REPLACE FUNCTION current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
AS $$
  SELECT current_setting('app.current_user_id', true)::uuid
$$;

-- ─── Helper: current user's role (SECURITY DEFINER so it can read profiles) ───

CREATE OR REPLACE FUNCTION current_user_role() RETURNS role
  LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT role FROM profiles WHERE id = current_user_id()
$$;

-- ─── Helper: current user's team_id ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION current_user_team() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT team_id FROM profiles WHERE id = current_user_id()
$$;

-- ─── Trigger: auto-update leads.updated_at ────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
  RETURNS trigger LANGUAGE plpgsql
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

  IF NEW.next_follow_up_at IS DISTINCT FROM OLD.next_follow_up_at THEN
    INSERT INTO activities(lead_id, user_id, type, field_name, old_value, new_value, follow_up_at)
    VALUES (NEW.id, v_user_id, 'follow_up', 'next_follow_up_at',
            OLD.next_follow_up_at::text, NEW.next_follow_up_at::text,
            NEW.next_follow_up_at);
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
AS $$
  SELECT id, full_name, email, role, team_id
  FROM profiles
  WHERE firebase_uid = p_uid
    AND is_active = true
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION get_profile_by_firebase_uid(text) TO app_user;
