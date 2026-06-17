-- Slice A fix — make cross-team assignment by subadmins actually work.
-- Run as superuser / table owner. Back up the database before running.
--
-- Two linked RLS gaps blocked §9 ("assign to anyone, no team restriction") for
-- subadmins. Admins were unaffected (their policies are `true`).
--
-- ── Bug 1: leads_update had no WITH CHECK ────────────────────────────────────
-- In PostgreSQL, an UPDATE policy with only USING reuses USING for the NEW row.
-- A subadmin's USING is "own-assigned OR unassigned OR in-my-team", so writing a
-- new row whose assignee is outside their team failed:
--   "new row violates row-level security policy for table \"leads\""
--
-- ── Bug 2: activities_insert required the lead to still be visible ────────────
-- Assigning a pooled lead to another team makes it invisible to the subadmin
-- (their SELECT policy no longer matches it). The leads_audit AFTER trigger and
-- the app's explicit `assignment` insert then both fail their WITH CHECK
-- (`lead_id IN (SELECT id FROM leads)`), aborting the assignment.
--
-- Fix: USING still gates WHICH existing rows a user may touch; an explicit
-- WITH CHECK governs the NEW row (target assignee unrestricted for
-- admin/subadmin, agents may not give a lead away). And admin/subadmin may write
-- audit rows even for a lead they just moved out of their own visibility.
-- Agents remain limited to activities on leads they can see (their own).

BEGIN;

-- ── leads_update ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS leads_update ON leads;

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

-- ── activities_insert ────────────────────────────────────────────────────────
DROP POLICY IF EXISTS activities_insert ON activities;

CREATE POLICY activities_insert ON activities FOR INSERT WITH CHECK (
  current_user_role() IN ('admin', 'subadmin')
  OR lead_id IN (SELECT id FROM leads)
);

COMMIT;
