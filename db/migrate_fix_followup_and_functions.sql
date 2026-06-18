-- ============================================================================
-- HOTFIX migration — run as the table owner / superuser (e.g. crm_user).
-- Back up first:
--   docker exec crm-postgres pg_dump -U crm_user -d finno_crm > ~/finno_backup_$(date +%F_%H%M).sql
--
-- Fixes (verified against the live DB on 2026-06-18):
--   1. `follow_up` is MISSING from the lead_status enum (it was mistakenly added
--      to activity_type). This breaks the Dashboard and the Follow-up filter.
--   2. get_assignable_users()  — was never applied (Slice B). Breaks assignment
--      dropdowns everywhere ("cannot see users").
--   3. get_reporting_*()       — was never applied (Slice C). Breaks Reporting.
--
-- ADD VALUE cannot run inside a multi-statement transaction in PostgreSQL, so do
-- NOT wrap this file in BEGIN/COMMIT. Run it as-is (psql executes each statement
-- with autocommit). The function blocks below are each self-contained.
-- ============================================================================

-- ─── 1. Restore the missing lead_status value ────────────────────────────────
-- Inserted BEFORE 'potential' to preserve the original pipeline ordering
-- (unassigned, lead, follow_up, potential, closed, issued, lost).
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'follow_up' BEFORE 'potential';

-- NOTE: the stray 'follow_up' label on the activity_type enum is harmless (the
-- app never writes it) and PostgreSQL cannot drop a single enum value in place,
-- so it is intentionally left as-is.

-- ─── 2. get_assignable_users() (Slice B) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION get_assignable_users()
  RETURNS TABLE (id uuid, full_name text, role role, team_id uuid, team_name text)
  LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT p.id, p.full_name, p.role, p.team_id, t.name AS team_name
  FROM profiles p
  LEFT JOIN teams t ON t.id = p.team_id
  WHERE p.is_active = true
  ORDER BY p.full_name;
$$;

GRANT EXECUTE ON FUNCTION get_assignable_users() TO app_user;

-- ─── 3. Reporting functions (Slice C) ────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_reporting_agents(
  p_product text DEFAULT NULL,
  p_team_id uuid DEFAULT NULL,
  p_source  text DEFAULT NULL
)
RETURNS TABLE (
  user_id        uuid,
  user_name      text,
  team_name      text,
  total_count    bigint,
  lead_count     bigint,
  follow_up_count bigint,
  potential_count bigint,
  closed_count   bigint,
  issued_count   bigint,
  case_size      numeric
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    p.id                                                                           AS user_id,
    p.full_name                                                                    AS user_name,
    t.name                                                                         AS team_name,
    COUNT(l.id) FILTER (WHERE l.status NOT IN ('lost','unassigned'))::bigint       AS total_count,
    COUNT(l.id) FILTER (WHERE l.status = 'lead')::bigint                           AS lead_count,
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
    AND (p_product IS NULL OR p_product::product = ANY(l.product_interest))
    AND (p_team_id IS NULL OR p.team_id = p_team_id)
    AND (p_source  IS NULL OR l.source  = p_source)
  GROUP BY p.id, p.full_name, t.name
  ORDER BY total_count DESC;
$$;

CREATE OR REPLACE FUNCTION get_reporting_teams(
  p_product text DEFAULT NULL,
  p_source  text DEFAULT NULL
)
RETURNS TABLE (
  team_id     uuid,
  team_name   text,
  total_count bigint,
  case_size   numeric
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    t.id                                                                           AS team_id,
    t.name                                                                         AS team_name,
    COUNT(l.id) FILTER (WHERE l.status NOT IN ('lost','unassigned'))::bigint       AS total_count,
    COALESCE(SUM(l.case_size) FILTER (WHERE l.status NOT IN ('lost','unassigned')), 0)::numeric
                                                                                   AS case_size
  FROM leads l
  JOIN  profiles p ON p.id = l.assigned_agent_id
  LEFT JOIN teams t ON t.id = p.team_id
  WHERE l.status NOT IN ('unassigned','lost')
    AND (p_product IS NULL OR p_product::product = ANY(l.product_interest))
    AND (p_source  IS NULL OR l.source  = p_source)
  GROUP BY t.id, t.name
  ORDER BY total_count DESC;
$$;

CREATE OR REPLACE FUNCTION get_reporting_sources(
  p_product text DEFAULT NULL,
  p_team_id uuid DEFAULT NULL
)
RETURNS TABLE (
  source      text,
  total_count bigint,
  case_size   numeric
)
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT
    l.source,
    COUNT(l.id) FILTER (WHERE l.status NOT IN ('lost','unassigned'))::bigint       AS total_count,
    COALESCE(SUM(l.case_size) FILTER (WHERE l.status NOT IN ('lost','unassigned')), 0)::numeric
                                                                                   AS case_size
  FROM leads l
  LEFT JOIN profiles p ON p.id = l.assigned_agent_id
  WHERE l.source IS NOT NULL
    AND l.status NOT IN ('unassigned','lost')
    AND (p_product IS NULL OR p_product::product = ANY(l.product_interest))
    AND (p_team_id IS NULL OR p.team_id = p_team_id)
  GROUP BY l.source
  ORDER BY total_count DESC;
$$;

GRANT EXECUTE ON FUNCTION get_reporting_agents(text, uuid, text) TO app_user;
GRANT EXECUTE ON FUNCTION get_reporting_teams(text, text)        TO app_user;
GRANT EXECUTE ON FUNCTION get_reporting_sources(text, uuid)      TO app_user;
