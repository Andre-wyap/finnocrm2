-- Phase 1 — Enums, tables, indexes
-- Run as the postgres superuser (or the table owner role, NOT app_user).

-- ─── Enable pgcrypto for gen_random_uuid() ────────────────────────────────────
-- (Only needed for Postgres < 13; Postgres 13+ has gen_random_uuid() built in)
-- CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── Enums ────────────────────────────────────────────────────────────────────

CREATE TYPE role AS ENUM ('agent', 'team_leader', 'subadmin', 'admin');
CREATE TYPE lead_status AS ENUM ('unassigned', 'lead', 'follow_up', 'potential', 'closed', 'issued', 'lost');
CREATE TYPE gender AS ENUM ('male', 'female');
CREATE TYPE smoking_status AS ENUM ('smoker', 'non_smoker');
CREATE TYPE product AS ENUM ('medical', 'critical_illness', 'life', 'personal_accident');
CREATE TYPE activity_type AS ENUM ('remark', 'call', 'status_change', 'field_change', 'assignment', 'archive', 'restore');

-- ─── Tables ───────────────────────────────────────────────────────────────────

CREATE TABLE teams (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  subadmin_id uuid,                         -- FK added after profiles
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE profiles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid text NOT NULL UNIQUE,        -- Firebase Auth UID (28-char string, not a uuid)
  full_name    text NOT NULL,
  email        text NOT NULL,
  phone        text,
  role         role NOT NULL,
  team_id      uuid REFERENCES teams(id) ON DELETE SET NULL,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Back-fill the FK now that profiles exists
ALTER TABLE teams
  ADD CONSTRAINT fk_teams_subadmin
  FOREIGN KEY (subadmin_id) REFERENCES profiles(id) ON DELETE SET NULL;

-- Source → team routing map (one landing-page source belongs to one team)
CREATE TABLE team_sources (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  source     text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

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
  team_id            uuid REFERENCES teams(id) ON DELETE SET NULL,  -- owning team; stamped at intake, follows assignment
  product_interest   product[] NOT NULL DEFAULT '{medical}',
  status             lead_status NOT NULL DEFAULT 'unassigned',
  assigned_agent_id  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  assigned_by        uuid REFERENCES profiles(id) ON DELETE SET NULL,
  assigned_at        timestamptz,
  case_size          numeric,
  possible_duplicate boolean NOT NULL DEFAULT false,
  archived_at        timestamptz,                    -- soft-archive (admin); NULL = active
  archived_by        uuid REFERENCES profiles(id) ON DELETE SET NULL,
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
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX idx_leads_assigned_agent   ON leads(assigned_agent_id);
CREATE INDEX idx_leads_status           ON leads(status);
CREATE INDEX idx_leads_mobile           ON leads(mobile);
CREATE INDEX idx_leads_active           ON leads(created_at) WHERE archived_at IS NULL;
CREATE INDEX idx_leads_team_id          ON leads(team_id) WHERE archived_at IS NULL;
CREATE INDEX idx_activities_lead_id     ON activities(lead_id);
CREATE INDEX idx_profiles_firebase_uid  ON profiles(firebase_uid);
CREATE INDEX idx_profiles_team_id       ON profiles(team_id);
CREATE INDEX idx_team_sources_team_id   ON team_sources(team_id);

-- ─── Table grants ─────────────────────────────────────────────────────────────

-- app_user: needs SELECT/INSERT/UPDATE/DELETE — RLS restricts actual rows
GRANT SELECT, INSERT, UPDATE, DELETE ON teams        TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON profiles     TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON leads        TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON activities   TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON team_sources TO app_user;

-- intake_role: only needs to INSERT leads (and read for duplicate check + source→team lookup)
GRANT SELECT, INSERT ON leads TO intake_role;
GRANT SELECT ON team_sources TO intake_role;
