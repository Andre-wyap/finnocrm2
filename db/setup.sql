-- FINNO CRM — Full database setup
-- Run as the postgres superuser against your existing database.
-- Passwords are passed at runtime via -v so they never touch this file:
--
--   sudo -u postgres psql -d crm-postgres \
--     -v app_user_password='choose-a-strong-password' \
--     -v intake_role_password='choose-a-strong-password' \
--     -f setup.sql
--
-- Generate strong passwords with:  openssl rand -hex 32

-- ─── 1. Roles ─────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    EXECUTE format('CREATE ROLE app_user WITH LOGIN PASSWORD %L', :'app_user_password');
    RAISE NOTICE 'Created role app_user';
  ELSE
    EXECUTE format('ALTER ROLE app_user WITH PASSWORD %L', :'app_user_password');
    RAISE NOTICE 'app_user already exists — password updated';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'intake_role') THEN
    EXECUTE format('CREATE ROLE intake_role WITH LOGIN BYPASSRLS PASSWORD %L', :'intake_role_password');
    RAISE NOTICE 'Created role intake_role';
  ELSE
    EXECUTE format('ALTER ROLE intake_role WITH PASSWORD %L', :'intake_role_password');
    RAISE NOTICE 'intake_role already exists — password updated';
  END IF;
END $$;

GRANT CONNECT ON DATABASE finno_crm TO app_user;
GRANT CONNECT ON DATABASE finno_crm TO intake_role;

-- ─── 2. Enums ─────────────────────────────────────────────────────────────────

DO $$ BEGIN CREATE TYPE role AS ENUM ('agent', 'subadmin', 'admin'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE lead_status AS ENUM ('unassigned', 'lead', 'potential', 'closed', 'issued', 'lost'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE gender AS ENUM ('male', 'female'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE smoking_status AS ENUM ('smoker', 'non_smoker'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE product AS ENUM ('medical', 'critical_illness', 'life', 'personal_accident'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE activity_type AS ENUM ('remark', 'call', 'status_change', 'field_change', 'assignment', 'follow_up'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 3. Tables ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS teams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  subadmin_id uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS profiles (
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

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_teams_subadmin'
  ) THEN
    ALTER TABLE teams
      ADD CONSTRAINT fk_teams_subadmin
      FOREIGN KEY (subadmin_id) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS leads (
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

CREATE TABLE IF NOT EXISTS activities (
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

-- ─── 4. Indexes ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_leads_assigned_agent  ON leads(assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_leads_status          ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_mobile          ON leads(mobile);
CREATE INDEX IF NOT EXISTS idx_leads_next_follow_up  ON leads(next_follow_up_at);
CREATE INDEX IF NOT EXISTS idx_activities_lead_id    ON activities(lead_id);
CREATE INDEX IF NOT EXISTS idx_profiles_firebase_uid ON profiles(firebase_uid);
CREATE INDEX IF NOT EXISTS idx_profiles_team_id      ON profiles(team_id);

-- ─── 5. Table grants ──────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON teams      TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON profiles   TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON leads      TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON activities TO app_user;

GRANT SELECT, INSERT ON leads TO intake_role;

-- ─── 6. Helper functions ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
AS $$
  SELECT current_setting('app.current_user_id', true)::uuid
$$;

CREATE OR REPLACE FUNCTION current_user_role() RETURNS role
  LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT role FROM profiles WHERE id = current_user_id()
$$;

CREATE OR REPLACE FUNCTION current_user_team() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT team_id FROM profiles WHERE id = current_user_id()
$$;

-- Bootstrap: resolve profile by firebase_uid without needing app.current_user_id
-- set first. SECURITY DEFINER bypasses profiles FORCE ROW LEVEL SECURITY.
-- Safe because input is the firebase_uid from a verified Firebase JWT only.
CREATE OR REPLACE FUNCTION get_profile_by_firebase_uid(p_uid text)
  RETURNS TABLE (id uuid, full_name text, email text, role role, team_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT id, full_name, email, role, team_id
  FROM profiles
  WHERE firebase_uid = p_uid
    AND is_active = true
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION get_profile_by_firebase_uid(text) TO app_user;

-- ─── 7. Triggers ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
  RETURNS trigger LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leads_updated_at ON leads;
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

DROP TRIGGER IF EXISTS leads_audit ON leads;
CREATE TRIGGER leads_audit
  AFTER UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION log_lead_changes();

-- ─── 8. Row Level Security ────────────────────────────────────────────────────

ALTER TABLE leads      ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles   ENABLE ROW LEVEL SECURITY;
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams      ENABLE ROW LEVEL SECURITY;

ALTER TABLE leads      FORCE ROW LEVEL SECURITY;
ALTER TABLE profiles   FORCE ROW LEVEL SECURITY;
ALTER TABLE activities FORCE ROW LEVEL SECURITY;
ALTER TABLE teams      FORCE ROW LEVEL SECURITY;

-- leads SELECT
DROP POLICY IF EXISTS leads_select ON leads;
CREATE POLICY leads_select ON leads FOR SELECT USING (
  CASE current_user_role()
    WHEN 'admin'    THEN true
    WHEN 'subadmin' THEN (
      status = 'unassigned'
      OR assigned_agent_id IN (SELECT id FROM profiles WHERE team_id = current_user_team())
    )
    WHEN 'agent'    THEN assigned_agent_id = current_user_id()
    ELSE false
  END
);

-- leads UPDATE
DROP POLICY IF EXISTS leads_update ON leads;
CREATE POLICY leads_update ON leads FOR UPDATE USING (
  CASE current_user_role()
    WHEN 'admin'    THEN true
    WHEN 'subadmin' THEN (
      status = 'unassigned'
      OR assigned_agent_id IN (SELECT id FROM profiles WHERE team_id = current_user_team())
    )
    WHEN 'agent'    THEN assigned_agent_id = current_user_id()
    ELSE false
  END
);

-- leads INSERT (admin manual; intake_role bypasses RLS entirely via BYPASSRLS)
DROP POLICY IF EXISTS leads_insert ON leads;
CREATE POLICY leads_insert ON leads FOR INSERT WITH CHECK (
  current_user_role() = 'admin'
);

-- leads DELETE
DROP POLICY IF EXISTS leads_delete ON leads;
CREATE POLICY leads_delete ON leads FOR DELETE USING (
  current_user_role() = 'admin'
);

-- profiles SELECT
DROP POLICY IF EXISTS profiles_select ON profiles;
CREATE POLICY profiles_select ON profiles FOR SELECT USING (
  CASE current_user_role()
    WHEN 'admin'    THEN true
    WHEN 'subadmin' THEN (id = current_user_id() OR team_id = current_user_team())
    WHEN 'agent'    THEN id = current_user_id()
    ELSE false
  END
);

-- profiles UPDATE
DROP POLICY IF EXISTS profiles_update ON profiles;
CREATE POLICY profiles_update ON profiles FOR UPDATE
  USING (id = current_user_id() OR current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');

-- profiles INSERT / DELETE (admin only)
DROP POLICY IF EXISTS profiles_insert ON profiles;
CREATE POLICY profiles_insert ON profiles FOR INSERT WITH CHECK (current_user_role() = 'admin');

DROP POLICY IF EXISTS profiles_delete ON profiles;
CREATE POLICY profiles_delete ON profiles FOR DELETE USING (current_user_role() = 'admin');

-- activities (scoped to leads the user can see)
DROP POLICY IF EXISTS activities_select ON activities;
CREATE POLICY activities_select ON activities FOR SELECT USING (
  lead_id IN (SELECT id FROM leads)
);

DROP POLICY IF EXISTS activities_insert ON activities;
CREATE POLICY activities_insert ON activities FOR INSERT WITH CHECK (
  lead_id IN (SELECT id FROM leads)
);

-- teams
DROP POLICY IF EXISTS teams_select ON teams;
CREATE POLICY teams_select ON teams FOR SELECT USING (
  CASE current_user_role()
    WHEN 'admin'    THEN true
    WHEN 'subadmin' THEN id = current_user_team()
    WHEN 'agent'    THEN id = current_user_team()
    ELSE false
  END
);

DROP POLICY IF EXISTS teams_insert ON teams;
CREATE POLICY teams_insert ON teams FOR INSERT WITH CHECK (current_user_role() = 'admin');

DROP POLICY IF EXISTS teams_update ON teams;
CREATE POLICY teams_update ON teams FOR UPDATE USING (current_user_role() = 'admin');

DROP POLICY IF EXISTS teams_delete ON teams;
CREATE POLICY teams_delete ON teams FOR DELETE USING (current_user_role() = 'admin');

-- ─── Done ─────────────────────────────────────────────────────────────────────
\echo '✓ FINNO CRM database setup complete'
\echo '  Next: copy the app_user and intake_role passwords into .env.local'
