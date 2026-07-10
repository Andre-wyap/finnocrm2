-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: add the 'approach' pipeline stage
--
-- Adds a new 'approach' stage to the lead_status enum, positioned between 'lead'
-- and 'follow_up' (unassigned → lead → approach → follow_up → potential → closed
-- → issued, with lost as the exit). Also extends the per-agent reporting
-- breakdown with an approach_count column so approach-stage leads are counted.
--
-- IMPORTANT: run this file WITHOUT wrapping it in a single transaction (psql
-- auto-commits each statement). PostgreSQL forbids using a freshly ADDed enum
-- value in the same transaction that added it, and get_reporting_agents below
-- references 'approach'. Running via `psql -f` (one statement at a time) is safe.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. lead_status enum: add 'approach' before 'follow_up' ───────────────────
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'approach' BEFORE 'follow_up';

-- ─── 2. Rebuild get_reporting_agents with an approach_count column ────────────
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
