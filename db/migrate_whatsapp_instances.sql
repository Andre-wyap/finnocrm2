-- ============================================================================
-- Migration — WhatsApp automation Slice 1: enablement + per-user instances
-- Run as the table owner / superuser (crm_user) on the VPS.
-- Back up first:
--   docker exec crm-postgres pg_dump -U crm_user -d finno_crm > ~/finno_backup_$(date +%F_%H%M).sql
--
-- Adds the admin-managed WhatsApp gate (profiles.wa_enabled) and the per-user
-- Evolution API instance registry (wa_instances) — see WHATSAPP_AUTOMATION_PLAN.md.
-- No ALTER TYPE ... ADD VALUE here (wa_instance_status is a NEW type), so this
-- whole file is safe to run as one script. Templates / flows / jobs land in
-- later slices.
--
-- Run this BEFORE deploying the matching app code: the app's login bootstrap
-- selects wa_enabled from get_profile_by_firebase_uid(), which this file
-- recreates with the extra column. (The old app code names its columns, so it
-- keeps working against the new function — the order is only critical one way.)
-- ============================================================================

-- ─── 1. profiles.wa_enabled (admin-managed feature gate) ─────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS wa_enabled boolean NOT NULL DEFAULT false;

-- ─── 2. wa_instances (one Evolution API instance per enabled user) ───────────
DO $$ BEGIN
  CREATE TYPE wa_instance_status AS ENUM ('disconnected', 'connecting', 'connected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS wa_instances (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id    uuid NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  instance_name text NOT NULL UNIQUE,       -- Evolution API instance name (finno_<profile uuid>)
  status        wa_instance_status NOT NULL DEFAULT 'disconnected',
  phone_number  text,                       -- connected WhatsApp number (from ownerJid)
  connected_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER wa_instances_updated_at
  BEFORE UPDATE ON wa_instances
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON wa_instances TO app_user;

-- ─── 3. RLS on wa_instances ───────────────────────────────────────────────────
ALTER TABLE wa_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_instances FORCE ROW LEVEL SECURITY;

-- A user manages only their own instance; admin sees and manages all.
-- INSERT additionally requires the WhatsApp gate to be on for the user —
-- the profiles self-row is always visible, so the subquery works for any role.
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

-- ─── 4. Pin wa_enabled on self-updates (admin-only field) ────────────────────
-- profiles_update already pins role / team_id for self-service edits; wa_enabled
-- joins that list so a user can't flip their own gate through /api/profile.
DROP POLICY IF EXISTS profiles_update ON profiles;
CREATE POLICY profiles_update ON profiles FOR UPDATE USING (
  id = current_user_id() OR current_user_role() = 'admin'
) WITH CHECK (
  current_user_role() = 'admin'
  OR (
    id = current_user_id()
    AND role = (SELECT role FROM profiles WHERE id = current_user_id())
    AND (team_id IS NOT DISTINCT FROM (SELECT team_id FROM profiles WHERE id = current_user_id()))
    AND wa_enabled = (SELECT wa_enabled FROM profiles WHERE id = current_user_id())
  )
);

-- ─── 5. Login bootstrap now also returns wa_enabled ──────────────────────────
-- Return-type change requires DROP + CREATE (CREATE OR REPLACE can't alter the
-- output columns). The old app code selects its columns by name, so it keeps
-- working against this new signature during the deploy window.
DROP FUNCTION IF EXISTS get_profile_by_firebase_uid(text);
CREATE FUNCTION get_profile_by_firebase_uid(p_uid text)
  RETURNS TABLE (id uuid, full_name text, email text, role role, team_id uuid, wa_enabled boolean)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
AS $$
  SELECT id, full_name, email, role, team_id, wa_enabled
  FROM profiles
  WHERE firebase_uid = p_uid
    AND is_active = true
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION get_profile_by_firebase_uid(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_profile_by_firebase_uid(text) TO app_user;
