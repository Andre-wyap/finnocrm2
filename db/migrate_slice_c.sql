-- Slice C migration: add SECURITY DEFINER reporting functions.
-- Run as superuser / table owner. Back up the database before running.
--
-- These functions bypass the team-scoped profiles RLS so both admin and
-- subadmin get the same full-agency reporting data (spec §12a).

-- ─── Per-user breakdown ───────────────────────────────────────────────────────

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

-- ─── Per-team breakdown ───────────────────────────────────────────────────────

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

-- ─── Per-source breakdown ─────────────────────────────────────────────────────

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

-- ─── Grants ───────────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION get_reporting_agents(text, uuid, text) TO app_user;
GRANT EXECUTE ON FUNCTION get_reporting_teams(text, text)        TO app_user;
GRANT EXECUTE ON FUNCTION get_reporting_sources(text, uuid)      TO app_user;
