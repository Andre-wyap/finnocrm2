-- ============================================================================
-- Migration — Phase 5 Slice 7: reporting scoped by team
-- Run as the table owner / superuser (e.g. crm_user) on the VPS.
-- Back up first:
--   docker exec crm-postgres pg_dump -U crm_user -d finno_crm > ~/finno_backup_$(date +%F_%H%M).sql
--
-- Adds a p_scope_team_id parameter to get_reporting_agents/teams/sources —
-- the caller's mandatory boundary (NULL for subadmin/admin, the team
-- leader's own team_id for team_leader), separate from the existing
-- p_team_id/p_source/p_product params, which stay optional UI filters a
-- subadmin/admin can additionally apply.
--
-- Also switches every team-scoping filter (both the new p_scope_team_id and
-- the existing p_team_id) from the assignee's p.team_id to the lead's own
-- l.team_id, and get_reporting_teams' GROUP BY from p.team_id to l.team_id —
-- CLAUDE.md §12a: "totals ... by owning team (leads.team_id), so a lead
-- moved across teams is credited to its current team," which can drift from
-- an agent's own current profile team_id over time (e.g. if that agent is
-- later moved to a different team without their old leads being touched).
--
-- Because the new p_scope_team_id parameter changes each function's argument
-- list, CREATE OR REPLACE would create new overloads alongside the old
-- signatures rather than replacing them — so the old signatures are dropped
-- first.
--
-- No enum values change here, so this is a normal transactional script.
-- ============================================================================

BEGIN;

DROP FUNCTION IF EXISTS get_reporting_agents(text, uuid, text);
DROP FUNCTION IF EXISTS get_reporting_teams(text, text);
DROP FUNCTION IF EXISTS get_reporting_sources(text, uuid);

-- ─── get_reporting_agents ─────────────────────────────────────────────────────
-- team_name here is still the agent's own profile team_id (a stable "which
-- team do they belong to" label) — only the filtering switched to l.team_id.
CREATE FUNCTION get_reporting_agents(
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
  follow_up_count bigint,
  potential_count bigint,
  closed_count    bigint,
  issued_count    bigint,
  case_size       numeric
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
    AND l.archived_at IS NULL
    AND (p_product       IS NULL OR p_product::product = ANY(l.product_interest))
    AND (p_scope_team_id IS NULL OR l.team_id = p_scope_team_id)
    AND (p_team_id       IS NULL OR l.team_id = p_team_id)
    AND (p_source        IS NULL OR l.source  = p_source)
  GROUP BY p.id, p.full_name, t.name
  ORDER BY total_count DESC;
$$;

-- ─── get_reporting_teams ──────────────────────────────────────────────────────
-- Grouped by the lead's own team_id now, not the assignee's profile team_id —
-- no longer needs the profiles join at all.
CREATE FUNCTION get_reporting_teams(
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

-- ─── get_reporting_sources ────────────────────────────────────────────────────
-- No longer needs the profiles join either, since the team filter now reads
-- l.team_id directly.
CREATE FUNCTION get_reporting_sources(
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

GRANT EXECUTE ON FUNCTION get_reporting_agents(uuid, text, uuid, text) TO app_user;
GRANT EXECUTE ON FUNCTION get_reporting_teams(uuid, text, text)        TO app_user;
GRANT EXECUTE ON FUNCTION get_reporting_sources(uuid, text, uuid)      TO app_user;

COMMIT;
