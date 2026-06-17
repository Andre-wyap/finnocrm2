-- Slice B migration — run against the live DB as the superuser / table owner.
-- Adds get_assignable_users() SECURITY DEFINER function so the assignment
-- dropdown can bypass the subadmin's team-scoped profiles SELECT and return
-- all active users (agent / subadmin / admin) regardless of team.

-- No structural schema changes; safe to run on the live DB at any time.
-- Back up the database before running.

CREATE OR REPLACE FUNCTION get_assignable_users()
  RETURNS TABLE (id uuid, full_name text, role role, team_id uuid, team_name text)
  LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT p.id, p.full_name, p.role, p.team_id, t.name AS team_name
  FROM profiles p
  LEFT JOIN teams t ON t.id = p.team_id
  WHERE p.is_active = true
  ORDER BY p.full_name;
$$;

GRANT EXECUTE ON FUNCTION get_assignable_users() TO app_user;
