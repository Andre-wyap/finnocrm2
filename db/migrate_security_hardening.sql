-- Security hardening migration.
-- Run as the database owner (crm_user) on the VPS after taking a pg_dump backup.
-- This migration is safe to run inside a transaction.

BEGIN;

-- App roles may use objects in public, but should not be able to create or
-- replace objects there.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM app_user;
REVOKE CREATE ON SCHEMA public FROM intake_role;
GRANT USAGE ON SCHEMA public TO app_user;
GRANT USAGE ON SCHEMA public TO intake_role;

-- Pin function lookup paths so SECURITY DEFINER helpers cannot be influenced
-- by caller-controlled schemas or future schema drift.
ALTER FUNCTION current_user_id() SET search_path = public, pg_temp;
ALTER FUNCTION current_user_role() SET search_path = public, pg_temp;
ALTER FUNCTION current_user_team() SET search_path = public, pg_temp;
ALTER FUNCTION set_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION log_lead_changes() SET search_path = public, pg_temp;
ALTER FUNCTION get_profile_by_firebase_uid(text) SET search_path = public, pg_temp;
ALTER FUNCTION get_assignable_users() SET search_path = public, pg_temp;
ALTER FUNCTION get_reporting_agents(uuid, text, uuid, text) SET search_path = public, pg_temp;
ALTER FUNCTION get_reporting_teams(uuid, text, text) SET search_path = public, pg_temp;
ALTER FUNCTION get_reporting_sources(uuid, text, uuid) SET search_path = public, pg_temp;

-- Legacy reporting overloads may exist on databases that ran earlier slices.
DO $$
BEGIN
  IF to_regprocedure('get_reporting_agents(text, uuid, text)') IS NOT NULL THEN
    ALTER FUNCTION get_reporting_agents(text, uuid, text) SET search_path = public, pg_temp;
  END IF;
  IF to_regprocedure('get_reporting_teams(text, text)') IS NOT NULL THEN
    ALTER FUNCTION get_reporting_teams(text, text) SET search_path = public, pg_temp;
  END IF;
  IF to_regprocedure('get_reporting_sources(text, uuid)') IS NOT NULL THEN
    ALTER FUNCTION get_reporting_sources(text, uuid) SET search_path = public, pg_temp;
  END IF;
END $$;

-- Remove broad default EXECUTE, then grant only helpers the app/RLS path needs.
REVOKE ALL ON FUNCTION current_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION current_user_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION current_user_team() FROM PUBLIC;
REVOKE ALL ON FUNCTION set_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION log_lead_changes() FROM PUBLIC;
REVOKE ALL ON FUNCTION get_profile_by_firebase_uid(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_assignable_users() FROM PUBLIC;
REVOKE ALL ON FUNCTION get_reporting_agents(uuid, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_reporting_teams(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION get_reporting_sources(uuid, text, uuid) FROM PUBLIC;

DO $$
BEGIN
  IF to_regprocedure('get_reporting_agents(text, uuid, text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION get_reporting_agents(text, uuid, text) FROM PUBLIC;
    REVOKE ALL ON FUNCTION get_reporting_agents(text, uuid, text) FROM app_user;
  END IF;
  IF to_regprocedure('get_reporting_teams(text, text)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION get_reporting_teams(text, text) FROM PUBLIC;
    REVOKE ALL ON FUNCTION get_reporting_teams(text, text) FROM app_user;
  END IF;
  IF to_regprocedure('get_reporting_sources(text, uuid)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION get_reporting_sources(text, uuid) FROM PUBLIC;
    REVOKE ALL ON FUNCTION get_reporting_sources(text, uuid) FROM app_user;
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION current_user_id() TO app_user;
GRANT EXECUTE ON FUNCTION current_user_role() TO app_user;
GRANT EXECUTE ON FUNCTION current_user_team() TO app_user;
GRANT EXECUTE ON FUNCTION get_profile_by_firebase_uid(text) TO app_user;
GRANT EXECUTE ON FUNCTION get_assignable_users() TO app_user;
GRANT EXECUTE ON FUNCTION get_reporting_agents(uuid, text, uuid, text) TO app_user;
GRANT EXECUTE ON FUNCTION get_reporting_teams(uuid, text, text) TO app_user;
GRANT EXECUTE ON FUNCTION get_reporting_sources(uuid, text, uuid) TO app_user;

COMMIT;
