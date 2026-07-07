-- Subadmin lead privacy.
-- Run as the database owner (crm_user) on the VPS after a pg_dump backup.
-- Safe to run inside a transaction.
--
-- Change: a subadmin is still agency-wide for the unassigned pool and for leads
-- owned by agents / team leaders, but can NO LONGER see leads that are currently
-- assigned to a DIFFERENT subadmin, or to ANY admin. A subadmin always still
-- sees their own assigned leads. Admin visibility is unchanged (sees everything).
--
-- This is enforced at the RLS layer so it holds on every surface: the Leads
-- list, the lead detail card, the Dashboard widgets, and the activity feed
-- (activities SELECT reuses the leads SELECT policy). Reporting is intentionally
-- left full-agency for subadmin/admin — it is aggregate counts only, no PII.

BEGIN;

-- Helper: role of an arbitrary profile id, bypassing profiles RLS so the leads
-- policy never has to reach through a second RLS layer. SECURITY DEFINER runs as
-- the owner; input is an internal uuid already present on the lead row.
CREATE OR REPLACE FUNCTION role_of(p_id uuid) RETURNS role
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT role FROM profiles WHERE id = p_id
$$;

REVOKE ALL ON FUNCTION role_of(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION role_of(uuid) TO app_user;

-- The shared predicate: which existing lead rows a subadmin may see/touch.
-- Visible when the lead is unassigned, assigned to me, or assigned to an
-- agent / team_leader. Hidden when assigned to another subadmin or an admin.
--   assigned_agent_id IS NULL
--   OR assigned_agent_id = current_user_id()
--   OR role_of(assigned_agent_id) NOT IN ('subadmin','admin')

-- ─── leads SELECT ─────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS leads_select ON leads;
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

-- ─── leads UPDATE ─────────────────────────────────────────────────────────────
-- USING mirrors SELECT so a subadmin can't blind-update a peer's/admin's lead by
-- id. WITH CHECK is unchanged: subadmin/admin may still assign to anyone (a
-- subadmin handing a lead to a peer/admin simply moves it out of their view).
DROP POLICY IF EXISTS leads_update ON leads;
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

COMMIT;
