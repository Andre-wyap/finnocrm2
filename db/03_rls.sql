-- Phase 1 — Row Level Security policies
-- Run as superuser / table owner.

-- ─── Enable RLS on all tables ─────────────────────────────────────────────────

ALTER TABLE leads      ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams      ENABLE ROW LEVEL SECURITY;

-- Force RLS even for the table owner (keeps testing honest)
ALTER TABLE leads      FORCE ROW LEVEL SECURITY;
ALTER TABLE profiles   FORCE ROW LEVEL SECURITY;
ALTER TABLE activities FORCE ROW LEVEL SECURITY;
ALTER TABLE teams      FORCE ROW LEVEL SECURITY;

-- ─── leads ────────────────────────────────────────────────────────────────────

-- SELECT
CREATE POLICY leads_select ON leads FOR SELECT USING (
  CASE current_user_role()
    WHEN 'admin'    THEN true
    WHEN 'subadmin' THEN (
      assigned_agent_id = current_user_id()        -- own assigned (even cross-team)
      OR status = 'unassigned'
      OR assigned_agent_id IN (
        SELECT id FROM profiles WHERE team_id = current_user_team()
      )
    )
    WHEN 'agent'    THEN assigned_agent_id = current_user_id()
    ELSE false
  END
);

-- UPDATE
-- USING gates WHICH existing rows a user may touch; WITH CHECK governs the NEW
-- row. Without an explicit WITH CHECK, Postgres reuses USING for the new row,
-- which would block a subadmin from assigning a lead to anyone outside their
-- team (contradicting §9). The explicit WITH CHECK leaves the target assignee
-- unrestricted for admin/subadmin and stops agents from giving leads away.
CREATE POLICY leads_update ON leads FOR UPDATE
USING (
  CASE current_user_role()
    WHEN 'admin'    THEN true
    WHEN 'subadmin' THEN (
      assigned_agent_id = current_user_id()        -- own assigned (even cross-team)
      OR status = 'unassigned'
      OR assigned_agent_id IN (
        SELECT id FROM profiles WHERE team_id = current_user_team()
      )
    )
    WHEN 'agent'    THEN assigned_agent_id = current_user_id()
    ELSE false
  END
)
WITH CHECK (
  current_user_role() IN ('admin', 'subadmin')
  OR (current_user_role() = 'agent' AND assigned_agent_id = current_user_id())
);

-- INSERT: admin can insert manually; intake_role bypasses RLS entirely
CREATE POLICY leads_insert ON leads FOR INSERT WITH CHECK (
  current_user_role() = 'admin'
);

-- DELETE: admin only (prefer setting status = 'lost')
CREATE POLICY leads_delete ON leads FOR DELETE USING (
  current_user_role() = 'admin'
);

-- ─── profiles ─────────────────────────────────────────────────────────────────

-- SELECT
CREATE POLICY profiles_select ON profiles FOR SELECT USING (
  CASE current_user_role()
    WHEN 'admin'    THEN true
    WHEN 'subadmin' THEN (
      id = current_user_id()
      OR team_id = current_user_team()
    )
    WHEN 'agent'    THEN id = current_user_id()
    ELSE false
  END
);

-- UPDATE: anyone can update their own non-privileged fields;
-- role and team_id are admin-only (enforced below via WITH CHECK)
CREATE POLICY profiles_update ON profiles FOR UPDATE USING (
  id = current_user_id() OR current_user_role() = 'admin'
) WITH CHECK (
  current_user_role() = 'admin'
  OR (
    -- Self-update: only own row, and role/team_id must not change
    id = current_user_id()
    AND role = (SELECT role FROM profiles WHERE id = current_user_id())
    AND (team_id IS NOT DISTINCT FROM (SELECT team_id FROM profiles WHERE id = current_user_id()))
  )
);

-- INSERT + DELETE: admin only
CREATE POLICY profiles_insert ON profiles FOR INSERT WITH CHECK (
  current_user_role() = 'admin'
);

CREATE POLICY profiles_delete ON profiles FOR DELETE USING (
  current_user_role() = 'admin'
);

-- ─── activities ───────────────────────────────────────────────────────────────

-- Scoped to leads the current user can already see (reuses leads SELECT logic)
CREATE POLICY activities_select ON activities FOR SELECT USING (
  lead_id IN (SELECT id FROM leads)  -- leads SELECT policy applies via RLS
);

-- Admin/subadmin may write audit rows even for a lead they just assigned out of
-- their own visibility (cross-team assignment). Agents are limited to leads they
-- can see (their own).
CREATE POLICY activities_insert ON activities FOR INSERT WITH CHECK (
  current_user_role() IN ('admin', 'subadmin')
  OR lead_id IN (SELECT id FROM leads)
);

-- ─── teams ────────────────────────────────────────────────────────────────────

CREATE POLICY teams_select ON teams FOR SELECT USING (
  CASE current_user_role()
    WHEN 'admin'    THEN true
    WHEN 'subadmin' THEN id = current_user_team()
    WHEN 'agent'    THEN id = current_user_team()
    ELSE false
  END
);

CREATE POLICY teams_insert ON teams FOR INSERT WITH CHECK (
  current_user_role() = 'admin'
);

CREATE POLICY teams_update ON teams FOR UPDATE USING (
  current_user_role() = 'admin'
);

CREATE POLICY teams_delete ON teams FOR DELETE USING (
  current_user_role() = 'admin'
);
