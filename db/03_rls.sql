-- Phase 1 — Row Level Security policies
-- Run as superuser / table owner.

-- ─── Enable RLS on all tables ─────────────────────────────────────────────────

ALTER TABLE leads        ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities   ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams        ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_media     ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_jobs      ENABLE ROW LEVEL SECURITY;

-- Force RLS even for the table owner (keeps testing honest)
ALTER TABLE leads        FORCE ROW LEVEL SECURITY;
ALTER TABLE profiles     FORCE ROW LEVEL SECURITY;
ALTER TABLE activities   FORCE ROW LEVEL SECURITY;
ALTER TABLE teams        FORCE ROW LEVEL SECURITY;
ALTER TABLE team_sources FORCE ROW LEVEL SECURITY;
ALTER TABLE wa_instances FORCE ROW LEVEL SECURITY;
ALTER TABLE wa_media     FORCE ROW LEVEL SECURITY;
ALTER TABLE wa_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE wa_jobs      FORCE ROW LEVEL SECURITY;

-- ─── leads ────────────────────────────────────────────────────────────────────

-- SELECT
-- Agent: own assigned only. Team leader: own assigned (even cross-team) OR
-- their team's leads (team_id stamped at intake — this is also their
-- team-scoped unassigned pool). Subadmin: agency-wide EXCEPT leads assigned to
-- a different subadmin or to any admin (they always still see their own). Admin:
-- everything, no restriction.
CREATE POLICY leads_select ON leads FOR SELECT USING (
  CASE current_user_role()
    WHEN 'admin'       THEN true
    WHEN 'subadmin'    THEN (
      assigned_agent_id IS NULL
      OR assigned_agent_id = current_user_id()
      OR role_of(assigned_agent_id) NOT IN ('subadmin','admin')
    )
    WHEN 'team_leader' THEN (
      assigned_agent_id = current_user_id()
      OR team_id = current_user_team()
    )
    WHEN 'agent'       THEN assigned_agent_id = current_user_id()
    ELSE false
  END
);

-- UPDATE
-- USING gates WHICH existing rows a user may touch; WITH CHECK governs the NEW
-- row. Without an explicit WITH CHECK, Postgres reuses USING for the new row,
-- which would block a subadmin from assigning a lead to anyone outside their
-- team (contradicting §9), and would let a team leader hand a lead to another
-- team or pull one in. The explicit WITH CHECK leaves the target assignee
-- unrestricted for admin/subadmin, pins a team leader's new assignee to their
-- own team (or leaves it unassigned/self) and keeps team_id at their team, and
-- stops agents from giving leads away.
CREATE POLICY leads_update ON leads FOR UPDATE
USING (
  CASE current_user_role()
    WHEN 'admin'       THEN true
    WHEN 'subadmin'    THEN (
      assigned_agent_id IS NULL
      OR assigned_agent_id = current_user_id()
      OR role_of(assigned_agent_id) NOT IN ('subadmin','admin')
    )
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

-- UPDATE: anyone can update their own non-privileged fields;
-- role, team_id, and wa_enabled are admin-only (enforced below via WITH CHECK)
CREATE POLICY profiles_update ON profiles FOR UPDATE USING (
  id = current_user_id() OR current_user_role() = 'admin'
) WITH CHECK (
  current_user_role() = 'admin'
  OR (
    -- Self-update: only own row, and role/team_id/wa_enabled must not change
    id = current_user_id()
    AND role = (SELECT role FROM profiles WHERE id = current_user_id())
    AND (team_id IS NOT DISTINCT FROM (SELECT team_id FROM profiles WHERE id = current_user_id()))
    AND wa_enabled = (SELECT wa_enabled FROM profiles WHERE id = current_user_id())
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
    WHEN 'admin'       THEN true
    WHEN 'subadmin'    THEN true
    WHEN 'team_leader' THEN id = current_user_team()
    WHEN 'agent'       THEN id = current_user_team()
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

-- ─── team_sources ─────────────────────────────────────────────────────────────

-- current_user_role() is cast to text (rather than casting the WHEN literals
-- to the role enum) so this policy compiles before the role enum gains
-- 'team_leader' (added in a later Phase 5 slice) — that branch is simply
-- unreachable until then, with no follow-up edit needed once it exists.
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

-- ─── wa_instances ─────────────────────────────────────────────────────────────

-- A user manages only their own WhatsApp instance; admin sees and manages all.
-- INSERT additionally requires the user's wa_enabled gate to be on — the
-- profiles self-row is always visible, so the subquery works for any role.
CREATE POLICY wa_instances_select ON wa_instances FOR SELECT USING (
  profile_id = current_user_id() OR current_user_role() = 'admin'
);

CREATE POLICY wa_instances_insert ON wa_instances FOR INSERT WITH CHECK (
  current_user_role() = 'admin'
  OR (
    profile_id = current_user_id()
    AND (SELECT wa_enabled FROM profiles WHERE id = current_user_id())
  )
);

CREATE POLICY wa_instances_update ON wa_instances FOR UPDATE
  USING (profile_id = current_user_id() OR current_user_role() = 'admin')
  WITH CHECK (profile_id = current_user_id() OR current_user_role() = 'admin');

CREATE POLICY wa_instances_delete ON wa_instances FOR DELETE USING (
  profile_id = current_user_id() OR current_user_role() = 'admin'
);

-- ─── WhatsApp templates and media ────────────────────────────────────────────

CREATE POLICY wa_media_select ON wa_media FOR SELECT USING (
  current_user_role() = 'admin'
  OR (SELECT wa_enabled FROM profiles WHERE id = current_user_id())
);
CREATE POLICY wa_media_insert ON wa_media FOR INSERT WITH CHECK (
  current_user_role() = 'admin'
);
CREATE POLICY wa_media_update ON wa_media FOR UPDATE
  USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');
CREATE POLICY wa_media_delete ON wa_media FOR DELETE USING (
  current_user_role() = 'admin'
);

CREATE POLICY wa_templates_select ON wa_templates FOR SELECT USING (
  current_user_role() = 'admin'
  OR (SELECT wa_enabled FROM profiles WHERE id = current_user_id())
);
CREATE POLICY wa_templates_insert ON wa_templates FOR INSERT WITH CHECK (
  current_user_role() = 'admin'
);
CREATE POLICY wa_templates_update ON wa_templates FOR UPDATE
  USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');
CREATE POLICY wa_templates_delete ON wa_templates FOR DELETE USING (
  current_user_role() = 'admin'
);

-- wa_jobs intentionally has no app_user policies. The privileged worker owns
-- all queue reads and transitions.
