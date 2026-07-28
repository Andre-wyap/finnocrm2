-- Phase 1 — Enums, tables, indexes
-- Run as the postgres superuser (or the table owner role, NOT app_user).

-- ─── Enable pgcrypto for gen_random_uuid() ────────────────────────────────────
-- (Only needed for Postgres < 13; Postgres 13+ has gen_random_uuid() built in)
-- CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── Enums ────────────────────────────────────────────────────────────────────

CREATE TYPE role AS ENUM ('agent', 'team_leader', 'subadmin', 'admin');
CREATE TYPE lead_status AS ENUM ('unassigned', 'lead', 'approach', 'follow_up', 'potential', 'closed', 'issued', 'lost');
CREATE TYPE gender AS ENUM ('male', 'female');
CREATE TYPE smoking_status AS ENUM ('smoker', 'non_smoker');
CREATE TYPE product AS ENUM ('medical', 'critical_illness', 'life', 'personal_accident');
CREATE TYPE activity_type AS ENUM ('remark', 'call', 'status_change', 'field_change', 'assignment', 'archive', 'restore', 'wa_message');
CREATE TYPE wa_instance_status AS ENUM ('disconnected', 'connecting', 'connected');
CREATE TYPE wa_job_status AS ENUM ('pending', 'processing', 'sent', 'failed', 'cancelled');
CREATE TYPE wa_run_status AS ENUM ('running', 'completed', 'cancelled', 'failed');

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
  wa_enabled   boolean NOT NULL DEFAULT false,   -- WhatsApp automation gate (admin-managed)
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
  highlighted_activity_id uuid,               -- FK added after activities table (below)
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

-- leads → activities highlight pointer (added here since activities is defined
-- after leads). ON DELETE SET NULL: deleting the remark clears the highlight.
ALTER TABLE leads
  ADD CONSTRAINT leads_highlighted_activity_id_fkey
  FOREIGN KEY (highlighted_activity_id) REFERENCES activities(id) ON DELETE SET NULL;

-- One Evolution API instance per WhatsApp-enabled user (§WHATSAPP_AUTOMATION_PLAN)
CREATE TABLE wa_instances (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id    uuid NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  instance_name text NOT NULL UNIQUE,       -- Evolution API instance name (finno_<profile uuid>)
  status        wa_instance_status NOT NULL DEFAULT 'disconnected',
  phone_number  text,                       -- connected WhatsApp number (from ownerJid)
  connected_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wa_media (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name   text NOT NULL,
  mime_type   text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes  integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  data        bytea NOT NULL CHECK (octet_length(data) = size_bytes),
  uploaded_by uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wa_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  body       text NOT NULL CHECK (length(trim(body)) > 0),
  media_id   uuid REFERENCES wa_media(id) ON DELETE SET NULL,
  is_active  boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wa_flows (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  is_active  boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wa_flow_steps (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id       uuid NOT NULL REFERENCES wa_flows(id) ON DELETE CASCADE,
  step_order    integer NOT NULL CHECK (step_order > 0),
  template_id   uuid NOT NULL REFERENCES wa_templates(id) ON DELETE RESTRICT,
  delay_minutes integer NOT NULL DEFAULT 0 CHECK (delay_minutes >= 0 AND delay_minutes <= 525600),
  UNIQUE (flow_id, step_order)
);

CREATE TABLE wa_flow_runs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id           uuid NOT NULL REFERENCES wa_flows(id) ON DELETE RESTRICT,
  lead_id           uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  sender_profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  status             wa_run_status NOT NULL DEFAULT 'running',
  current_step       integer NOT NULL DEFAULT 0 CHECK (current_step >= 0),
  last_error         text,
  started_by         uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  started_at         timestamptz NOT NULL DEFAULT now(),
  finished_at        timestamptz
);

CREATE TABLE wa_jobs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id            uuid REFERENCES wa_flow_runs(id) ON DELETE CASCADE,
  flow_step_id      uuid REFERENCES wa_flow_steps(id) ON DELETE SET NULL,
  lead_id           uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  template_id       uuid NOT NULL REFERENCES wa_templates(id) ON DELETE RESTRICT,
  sender_profile_id uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  run_at             timestamptz NOT NULL DEFAULT now(),
  status             wa_job_status NOT NULL DEFAULT 'pending',
  attempts           integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error         text,
  sent_at            timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
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
CREATE INDEX idx_wa_jobs_due            ON wa_jobs(status, run_at) WHERE status = 'pending';
CREATE INDEX idx_wa_jobs_run_id         ON wa_jobs(run_id) WHERE run_id IS NOT NULL;
CREATE UNIQUE INDEX idx_wa_flow_runs_one_running_per_lead ON wa_flow_runs(lead_id) WHERE status = 'running';
CREATE INDEX idx_wa_flow_runs_lead      ON wa_flow_runs(lead_id, started_at DESC);

-- ─── Table grants ─────────────────────────────────────────────────────────────

-- app_user: needs SELECT/INSERT/UPDATE/DELETE — RLS restricts actual rows
GRANT SELECT, INSERT, UPDATE, DELETE ON teams        TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON profiles     TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON leads        TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON activities   TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON team_sources TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON wa_instances TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON wa_media, wa_templates TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON wa_flows, wa_flow_steps, wa_flow_runs TO app_user;

-- intake_role: only needs to INSERT leads (and read for duplicate check + source→team lookup)
GRANT SELECT, INSERT ON leads TO intake_role;
GRANT SELECT ON team_sources TO intake_role;
GRANT SELECT ON profiles, wa_instances, wa_templates, wa_media TO intake_role;
GRANT SELECT ON wa_flows, wa_flow_steps, wa_flow_runs TO intake_role;
GRANT INSERT, UPDATE ON wa_flow_runs TO intake_role;
GRANT SELECT, INSERT, UPDATE ON wa_jobs TO intake_role;
GRANT INSERT ON activities TO intake_role;
