-- FINNO CRM — DESTRUCTIVE rebuild
-- Drops the mismatched schema and recreates it correctly from the spec.
-- Roles (app_user, intake_role) are assumed to already exist and are left alone.
-- Re-inserts the bootstrap admin profile at the end.
--
-- Run as the container superuser:
--   docker exec -i crm-postgres psql -U crm_user -d finno_crm -f /tmp/rebuild.sql

BEGIN;

-- ─── 0. Teardown (drop wrong tables + enums) ──────────────────────────────────
DROP TABLE IF EXISTS activities CASCADE;
DROP TABLE IF EXISTS leads      CASCADE;
DROP TABLE IF EXISTS profiles   CASCADE;
DROP TABLE IF EXISTS teams      CASCADE;

DROP TYPE IF EXISTS activity_type  CASCADE;
DROP TYPE IF EXISTS product        CASCADE;
DROP TYPE IF EXISTS smoking_status CASCADE;
DROP TYPE IF EXISTS smoker         CASCADE;   -- wrong enum from old schema
DROP TYPE IF EXISTS lead_status    CASCADE;
DROP TYPE IF EXISTS gender         CASCADE;
DROP TYPE IF EXISTS role           CASCADE;

-- ─── 1. Enums ─────────────────────────────────────────────────────────────────
CREATE TYPE role           AS ENUM ('agent', 'subadmin', 'admin');
CREATE TYPE lead_status    AS ENUM ('unassigned', 'lead', 'potential', 'closed', 'issued', 'lost');
CREATE TYPE gender         AS ENUM ('male', 'female');
CREATE TYPE smoking_status AS ENUM ('smoker', 'non_smoker');
CREATE TYPE product        AS ENUM ('medical', 'critical_illness', 'life', 'personal_accident');
CREATE TYPE activity_type  AS ENUM ('remark', 'call', 'status_change', 'field_change', 'assignment', 'follow_up');

-- ─── 2. Tables ────────────────────────────────────────────────────────────────
CREATE TABLE teams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  subadmin_id uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE profiles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid text NOT NULL UNIQUE,
  full_name    text NOT NULL,
  email        text NOT NULL,
  phone        text,
  role         role NOT NULL,
  team_id      uuid REFERENCES teams(id) ON DELETE SET NULL,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE teams
  ADD CONSTRAINT fk_teams_subadmin
  FOREIGN KEY (subadmin_id) REFERENCES profiles(id) ON DELETE SET NULL;

CREATE TABLE leads (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name          text NOT NULL,
  date_of_birth      date,
  gender             gender,
  smoking_status     smoking_status,
  mobile             text NOT NULL,
  email              text,
  state              text,
  source             text NOT NULL,
  product_interest   product[] NOT NULL DEFAULT '{medical}',
  status             lead_status NOT NULL DEFAULT 'unassigned',
  assigned_agent_id  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  assigned_by        uuid REFERENCES profiles(id) ON DELETE SET NULL,
  assigned_at        timestamptz,
  case_size          numeric,
  next_follow_up_at  timestamptz,
  possible_duplicate boolean NOT NULL DEFAULT false,
  raw_payload        jsonb,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE activities (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id      uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  type         activity_type NOT NULL,
  content      text,
  field_name   text,
  old_value    text,
  new_value    text,
  follow_up_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ─── 3. Indexes ───────────────────────────────────────────────────────────────
CREATE INDEX idx_leads_assigned_agent  ON leads(assigned_agent_id);
CREATE INDEX idx_leads_status          ON leads(status);
CREATE INDEX idx_leads_mobile          ON leads(mobile);
CREATE INDEX idx_leads_next_follow_up  ON leads(next_follow_up_at);
CREATE INDEX idx_activities_lead_id    ON activities(lead_id);
CREATE INDEX idx_profiles_firebase_uid ON profiles(firebase_uid);
CREATE INDEX idx_profiles_team_id      ON profiles(team_id);

-- ─── 4. Grants (roles already exist) ──────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON teams      TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON profiles   TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON leads      TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON activities TO app_user;
GRANT SELECT, INSERT ON leads TO intake_role;

-- ─── 5. Helper functions ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
AS $$ SELECT current_setting('app.current_user_id', true)::uuid $$;

CREATE OR REPLACE FUNCTION current_user_role() RETURNS role
  LANGUAGE sql STABLE SECURITY DEFINER
AS $$ SELECT role FROM profiles WHERE id = current_user_id() $$;

CREATE OR REPLACE FUNCTION current_user_team() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
AS $$ SELECT team_id FROM profiles WHERE id = current_user_id() $$;

CREATE OR REPLACE FUNCTION get_profile_by_firebase_uid(p_uid text)
  RETURNS TABLE (id uuid, full_name text, email text, role role, team_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT id, full_name, email, role, team_id
  FROM profiles
  WHERE firebase_uid = p_uid AND is_active = true
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION get_profile_by_firebase_uid(text) TO app_user;

-- ─── 6. Triggers ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
  RETURNS trigger LANGUAGE plpgsql
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION log_lead_changes()
  RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := current_user_id();
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO activities(lead_id, user_id, type, content, old_value, new_value)
    VALUES (NEW.id, v_user_id, 'status_change', 'Status changed', OLD.status::text, NEW.status::text);
  END IF;
  IF NEW.full_name IS DISTINCT FROM OLD.full_name THEN
    INSERT INTO activities(lead_id, user_id, type, field_name, old_value, new_value)
    VALUES (NEW.id, v_user_id, 'field_change', 'full_name', OLD.full_name, NEW.full_name);
  END IF;
  IF NEW.date_of_birth IS DISTINCT FROM OLD.date_of_birth THEN
    INSERT INTO activities(lead_id, user_id, type, field_name, old_value, new_value)
    VALUES (NEW.id, v_user_id, 'field_change', 'date_of_birth', OLD.date_of_birth::text, NEW.date_of_birth::text);
  END IF;
  IF NEW.gender IS DISTINCT FROM OLD.gender THEN
    INSERT INTO activities(lead_id, user_id, type, field_name, old_value, new_value)
    VALUES (NEW.id, v_user_id, 'field_change', 'gender', OLD.gender::text, NEW.gender::text);
  END IF;
  IF NEW.smoking_status IS DISTINCT FROM OLD.smoking_status THEN
    INSERT INTO activities(lead_id, user_id, type, field_name, old_value, new_value)
    VALUES (NEW.id, v_user_id, 'field_change', 'smoking_status', OLD.smoking_status::text, NEW.smoking_status::text);
  END IF;
  IF NEW.mobile IS DISTINCT FROM OLD.mobile THEN
    INSERT INTO activities(lead_id, user_id, type, field_name, old_value, new_value)
    VALUES (NEW.id, v_user_id, 'field_change', 'mobile', OLD.mobile, NEW.mobile);
  END IF;
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    INSERT INTO activities(lead_id, user_id, type, field_name, old_value, new_value)
    VALUES (NEW.id, v_user_id, 'field_change', 'email', OLD.email, NEW.email);
  END IF;
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    INSERT INTO activities(lead_id, user_id, type, field_name, old_value, new_value)
    VALUES (NEW.id, v_user_id, 'field_change', 'state', OLD.state, NEW.state);
  END IF;
  IF NEW.product_interest IS DISTINCT FROM OLD.product_interest THEN
    INSERT INTO activities(lead_id, user_id, type, field_name, old_value, new_value)
    VALUES (NEW.id, v_user_id, 'field_change', 'product_interest',
            array_to_string(OLD.product_interest, ', '), array_to_string(NEW.product_interest, ', '));
  END IF;
  IF NEW.case_size IS DISTINCT FROM OLD.case_size THEN
    INSERT INTO activities(lead_id, user_id, type, field_name, old_value, new_value)
    VALUES (NEW.id, v_user_id, 'field_change', 'case_size', OLD.case_size::text, NEW.case_size::text);
  END IF;
  IF NEW.next_follow_up_at IS DISTINCT FROM OLD.next_follow_up_at THEN
    INSERT INTO activities(lead_id, user_id, type, field_name, old_value, new_value, follow_up_at)
    VALUES (NEW.id, v_user_id, 'follow_up', 'next_follow_up_at',
            OLD.next_follow_up_at::text, NEW.next_follow_up_at::text, NEW.next_follow_up_at);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER leads_audit
  AFTER UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION log_lead_changes();

-- ─── 7. Row Level Security ────────────────────────────────────────────────────
ALTER TABLE leads      ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams      ENABLE ROW LEVEL SECURITY;

ALTER TABLE leads      FORCE ROW LEVEL SECURITY;
ALTER TABLE profiles   FORCE ROW LEVEL SECURITY;
ALTER TABLE activities FORCE ROW LEVEL SECURITY;
ALTER TABLE teams      FORCE ROW LEVEL SECURITY;

CREATE POLICY leads_select ON leads FOR SELECT USING (
  CASE current_user_role()
    WHEN 'admin'    THEN true
    WHEN 'subadmin' THEN (status = 'unassigned' OR assigned_agent_id IN (SELECT id FROM profiles WHERE team_id = current_user_team()))
    WHEN 'agent'    THEN assigned_agent_id = current_user_id()
    ELSE false
  END
);
CREATE POLICY leads_update ON leads FOR UPDATE USING (
  CASE current_user_role()
    WHEN 'admin'    THEN true
    WHEN 'subadmin' THEN (status = 'unassigned' OR assigned_agent_id IN (SELECT id FROM profiles WHERE team_id = current_user_team()))
    WHEN 'agent'    THEN assigned_agent_id = current_user_id()
    ELSE false
  END
);
CREATE POLICY leads_insert ON leads FOR INSERT WITH CHECK (current_user_role() = 'admin');
CREATE POLICY leads_delete ON leads FOR DELETE USING (current_user_role() = 'admin');

CREATE POLICY profiles_select ON profiles FOR SELECT USING (
  CASE current_user_role()
    WHEN 'admin'    THEN true
    WHEN 'subadmin' THEN (id = current_user_id() OR team_id = current_user_team())
    WHEN 'agent'    THEN id = current_user_id()
    ELSE false
  END
);
CREATE POLICY profiles_update ON profiles FOR UPDATE
  USING (id = current_user_id() OR current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');
CREATE POLICY profiles_insert ON profiles FOR INSERT WITH CHECK (current_user_role() = 'admin');
CREATE POLICY profiles_delete ON profiles FOR DELETE USING (current_user_role() = 'admin');

CREATE POLICY activities_select ON activities FOR SELECT USING (lead_id IN (SELECT id FROM leads));
CREATE POLICY activities_insert ON activities FOR INSERT WITH CHECK (lead_id IN (SELECT id FROM leads));

CREATE POLICY teams_select ON teams FOR SELECT USING (
  CASE current_user_role()
    WHEN 'admin'    THEN true
    WHEN 'subadmin' THEN id = current_user_team()
    WHEN 'agent'    THEN id = current_user_team()
    ELSE false
  END
);
CREATE POLICY teams_insert ON teams FOR INSERT WITH CHECK (current_user_role() = 'admin');
CREATE POLICY teams_update ON teams FOR UPDATE USING (current_user_role() = 'admin');
CREATE POLICY teams_delete ON teams FOR DELETE USING (current_user_role() = 'admin');

-- ─── 8. Re-insert bootstrap admin ─────────────────────────────────────────────
INSERT INTO profiles (firebase_uid, full_name, email, role, is_active)
VALUES ('YNMxtjytPWfuBtHKsouhOCwvu642', 'Andrew Yap', 'andrewyapcf@gmail.com', 'admin', true);

COMMIT;
