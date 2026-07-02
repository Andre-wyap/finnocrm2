-- ============================================================================
-- Migration — Phase 5 Slice 4: RLS rewrite for the 4-tier role model
-- Run as the table owner / superuser (e.g. crm_user) on the VPS.
-- Back up first:
--   docker exec crm-postgres pg_dump -U crm_user -d finno_crm > ~/finno_backup_$(date +%F_%H%M).sql
--
-- REQUIRES db/migrate_team_leader_role.sql (Slice 3) to have already run —
-- this file references 'team_leader' as a literal enum comparison (not the
-- ::text cast trick used in migrate_team_sources.sql), so the value must
-- already exist in the role enum or CREATE POLICY will fail to compile.
--
-- Rewrites leads_select / leads_update / profiles_select / teams_select so
-- subadmin becomes agency-wide (no restriction) and team_leader takes over
-- the team-bounded behavior subadmin used to have (CLAUDE.md §3/§6):
--   agent        - own assigned only
--   team_leader  - own assigned (even cross-team) OR own team's leads
--                  (which is also their team-scoped unassigned pool)
--   subadmin     - all rows, unrestricted
--   admin        - all rows, unrestricted
--
-- No enum values change here, so this is a normal transactional script.
-- ============================================================================

BEGIN;

-- ─── 0. Data fix-up: establish the "assignee's team = lead's team" invariant
-- for already-assigned leads ─────────────────────────────────────────────────
-- Slice 1's backfill only set team_id from the source → team_sources map, so
-- a lead that was already assigned to someone before this migration (and
-- whose source doesn't map to a team) can still have team_id NULL even
-- though it has an owner. The new team_leader WITH CHECK below requires
-- team_id = current_user_team() to touch a lead, so — without this fix-up —
-- a team leader who legitimately owns such a lead (assigned_agent_id = them)
-- would be unable to edit it (not even status/case_size) until someone
-- fixes its team_id. This one-time correction only touches orphaned
-- (team_id IS NULL) rows that already have an assignee with a team, so it
-- never overrides a team_id that source-mapping or a real assignment already
-- set.
UPDATE leads l
SET team_id = p.team_id
FROM profiles p
WHERE l.assigned_agent_id = p.id
  AND l.team_id IS NULL
  AND p.team_id IS NOT NULL;

-- ─── 1. leads_select ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS leads_select ON leads;

CREATE POLICY leads_select ON leads FOR SELECT USING (
  CASE current_user_role()
    WHEN 'admin'       THEN true
    WHEN 'subadmin'    THEN true
    WHEN 'team_leader' THEN (
      assigned_agent_id = current_user_id()
      OR team_id = current_user_team()
    )
    WHEN 'agent'       THEN assigned_agent_id = current_user_id()
    ELSE false
  END
);

-- ─── 2. leads_update ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS leads_update ON leads;

CREATE POLICY leads_update ON leads FOR UPDATE
USING (
  CASE current_user_role()
    WHEN 'admin'       THEN true
    WHEN 'subadmin'    THEN true
    WHEN 'team_leader' THEN (
      assigned_agent_id = current_user_id()
      OR team_id = current_user_team()
    )
    WHEN 'agent'       THEN assigned_agent_id = current_user_id()
    ELSE false
  END
)
WITH CHECK (
  CASE current_user_role()
    WHEN 'admin'       THEN true
    WHEN 'subadmin'    THEN true
    WHEN 'team_leader' THEN (
      team_id = current_user_team()
      AND (
        assigned_agent_id IS NULL
        OR assigned_agent_id = current_user_id()
        OR assigned_agent_id IN (
          SELECT id FROM profiles WHERE team_id = current_user_team()
        )
      )
    )
    WHEN 'agent'       THEN assigned_agent_id = current_user_id()
    ELSE false
  END
);

-- ─── 3. profiles_select ───────────────────────────────────────────────────────
DROP POLICY IF EXISTS profiles_select ON profiles;

CREATE POLICY profiles_select ON profiles FOR SELECT USING (
  CASE current_user_role()
    WHEN 'admin'       THEN true
    WHEN 'subadmin'    THEN true
    WHEN 'team_leader' THEN (
      id = current_user_id()
      OR team_id = current_user_team()
    )
    WHEN 'agent'       THEN id = current_user_id()
    ELSE false
  END
);

-- ─── 4. teams_select ──────────────────────────────────────────────────────────
-- Subadmin is agency-wide (§3), so it must see every team, not just its own —
-- team_leader inherits the old bounded behavior instead.
DROP POLICY IF EXISTS teams_select ON teams;

CREATE POLICY teams_select ON teams FOR SELECT USING (
  CASE current_user_role()
    WHEN 'admin'       THEN true
    WHEN 'subadmin'    THEN true
    WHEN 'team_leader' THEN id = current_user_team()
    WHEN 'agent'       THEN id = current_user_team()
    ELSE false
  END
);

COMMIT;
