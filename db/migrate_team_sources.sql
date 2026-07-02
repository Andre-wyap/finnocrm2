-- ============================================================================
-- Migration — Phase 5 Slice 1: source → team foundation
-- Run as the table owner / superuser (e.g. crm_user) on the VPS.
-- Back up first:
--   docker exec crm-postgres pg_dump -U crm_user -d finno_crm > ~/finno_backup_$(date +%F_%H%M).sql
--
-- Adds team_sources (the source → team routing map) and leads.team_id (the
-- lead's owning team, stamped at intake and moved on assignment — see
-- CLAUDE.md §5/§7/§9). This slice only lays the foundation: intake stamping
-- (5.2), the team_leader role (5.3), and the RLS/reporting scoping that reads
-- team_id (5.4+) land in later slices. No enum values change here, so this
-- whole file is a normal multi-statement script (no ALTER TYPE ... ADD VALUE
-- restriction applies).
-- ============================================================================

-- ─── 1. team_sources (source → team routing map) ────────────────────────────
CREATE TABLE IF NOT EXISTS team_sources (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  source     text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_team_sources_team_id ON team_sources(team_id);

-- ─── 2. leads.team_id (owning team) ──────────────────────────────────────────
-- NULL = orphan (unmapped source, or currently owned by a teamless admin).
ALTER TABLE leads ADD COLUMN IF NOT EXISTS team_id uuid REFERENCES teams(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_leads_team_id ON leads(team_id) WHERE archived_at IS NULL;

-- ─── 3. Grants ────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON team_sources TO app_user;
GRANT SELECT ON team_sources TO intake_role;

-- ─── 4. Backfill existing leads from the (likely still-empty) map ───────────
-- No-op until an admin populates team_sources (Slice 9 UI); safe to re-run.
UPDATE leads l
SET team_id = ts.team_id
FROM team_sources ts
WHERE l.source = ts.source
  AND l.team_id IS NULL;

-- ─── 5. RLS on team_sources ───────────────────────────────────────────────────
ALTER TABLE team_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_sources FORCE ROW LEVEL SECURITY;

-- current_user_role() is cast to text (rather than the WHEN literals being
-- cast to the role enum) so this policy is valid before Slice 3 adds
-- 'team_leader' to the role enum — the branch is simply unreachable until
-- then, and needs no follow-up edit once it exists.
CREATE POLICY team_sources_select ON team_sources FOR SELECT USING (
  CASE current_user_role()::text
    WHEN 'admin'       THEN true
    WHEN 'subadmin'    THEN true
    WHEN 'team_leader' THEN team_id = current_user_team()
    ELSE false
  END
);

CREATE POLICY team_sources_insert ON team_sources FOR INSERT WITH CHECK (
  current_user_role() = 'admin'
);

CREATE POLICY team_sources_update ON team_sources FOR UPDATE USING (
  current_user_role() = 'admin'
);

CREATE POLICY team_sources_delete ON team_sources FOR DELETE USING (
  current_user_role() = 'admin'
);
