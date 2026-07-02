-- ============================================================================
-- Migration — Phase 5 Slice 5: role-aware get_assignable_users()
-- Run as the table owner / superuser (e.g. crm_user) on the VPS.
-- Back up first:
--   docker exec crm-postgres pg_dump -U crm_user -d finno_crm > ~/finno_backup_$(date +%F_%H%M).sql
--
-- get_assignable_users() previously returned every active user agency-wide
-- regardless of caller, with no team_leader awareness at all (it predates the
-- 4-tier role model). CREATE OR REPLACE keeps the existing signature/grant —
-- app/api/agents, app/api/leads/[id]/assign, app/api/leads/bulk-assign, and
-- app/api/reporting all call this function, so scoping it here scopes all of
-- them for free.
--
-- team_leader now only sees their own team's active users (CLAUDE.md §9);
-- subadmin/admin still see everyone; agent gets an empty result (agents are
-- 403'd from the assignment routes before this is ever called, but the
-- function is defensive on its own).
--
-- No enum values change here, so this is a normal transactional script.
-- ============================================================================

CREATE OR REPLACE FUNCTION get_assignable_users()
  RETURNS TABLE (id uuid, full_name text, role role, team_id uuid, team_name text)
  LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT p.id, p.full_name, p.role, p.team_id, t.name AS team_name
  FROM profiles p
  LEFT JOIN teams t ON t.id = p.team_id
  WHERE p.is_active = true
    AND (
      current_user_role() IN ('subadmin', 'admin')
      OR (current_user_role() = 'team_leader' AND p.team_id = current_user_team())
    )
  ORDER BY p.full_name;
$$;

GRANT EXECUTE ON FUNCTION get_assignable_users() TO app_user;
