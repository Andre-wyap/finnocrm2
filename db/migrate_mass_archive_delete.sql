-- ============================================================================
-- Migration — Mass archive + mass delete of leads (admin only)
-- Run as the table owner / superuser (e.g. crm_user) on the VPS.
-- Back up first:
--   docker exec crm-postgres pg_dump -U crm_user -d finno_crm > ~/finno_backup_$(date +%F_%H%M).sql
--
-- Adds a recoverable soft-archive to leads (archived_at / archived_by) plus two
-- audit activity types. Hard delete already exists via the admin-only DELETE RLS
-- policy; this migration only wires the audit + filtering for archive.
--
-- ALTER TYPE ... ADD VALUE cannot run inside a multi-statement transaction in
-- PostgreSQL, so do NOT wrap this file in BEGIN/COMMIT. psql runs each statement
-- with autocommit. The function blocks below are each self-contained.
-- ============================================================================

-- ─── 1. Soft-archive columns ─────────────────────────────────────────────────
-- archived_at NULL  → active lead (the normal case)
-- archived_at set   → archived: hidden from Leads list, Dashboard, Reporting,
--                     and the Unassigned pool; recoverable from /admin/leads.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES profiles(id) ON DELETE SET NULL;

-- Partial index keeps the "active leads" filter (archived_at IS NULL) cheap.
CREATE INDEX IF NOT EXISTS idx_leads_active ON leads (created_at) WHERE archived_at IS NULL;

-- ─── 2. Audit activity types ─────────────────────────────────────────────────
-- Archive / restore are logged explicitly by the bulk endpoint (like assignment),
-- so the lead's history feed records who archived or restored it and when.
ALTER TYPE activity_type ADD VALUE IF NOT EXISTS 'archive';
ALTER TYPE activity_type ADD VALUE IF NOT EXISTS 'restore';

-- ─── 3. Reporting functions exclude archived leads ───────────────────────────
-- Archived leads must drop out of the agency Reporting page, the same way they
-- drop out of the Dashboard and Leads list. CREATE OR REPLACE keeps the existing
-- signatures/grants; only the WHERE clauses gain `AND l.archived_at IS NULL`.

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
    AND l.archived_at IS NULL
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
    AND l.archived_at IS NULL
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
    AND l.archived_at IS NULL
    AND (p_product IS NULL OR p_product::product = ANY(l.product_interest))
    AND (p_team_id IS NULL OR p.team_id = p_team_id)
  GROUP BY l.source
  ORDER BY total_count DESC;
$$;

GRANT EXECUTE ON FUNCTION get_reporting_agents(text, uuid, text) TO app_user;
GRANT EXECUTE ON FUNCTION get_reporting_teams(text, text)        TO app_user;
GRANT EXECUTE ON FUNCTION get_reporting_sources(text, uuid)      TO app_user;
