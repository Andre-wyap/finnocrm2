-- ============================================================================
-- WhatsApp automation Slice 3: delayed flows, steps, runs, and job linkage
-- Run as crm_user on the VPS after migrate_whatsapp_templates.sql.
-- ============================================================================

BEGIN;

DO $$ BEGIN
  CREATE TYPE wa_run_status AS ENUM ('running', 'completed', 'cancelled', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS wa_flows (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  is_active  boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wa_flow_steps (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id       uuid NOT NULL REFERENCES wa_flows(id) ON DELETE CASCADE,
  step_order    integer NOT NULL CHECK (step_order > 0),
  template_id   uuid NOT NULL REFERENCES wa_templates(id) ON DELETE RESTRICT,
  delay_minutes integer NOT NULL DEFAULT 0 CHECK (delay_minutes >= 0 AND delay_minutes <= 525600),
  UNIQUE (flow_id, step_order)
);

CREATE TABLE IF NOT EXISTS wa_flow_runs (
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_flow_runs_one_running_per_lead
  ON wa_flow_runs(lead_id)
  WHERE status = 'running';
CREATE INDEX IF NOT EXISTS idx_wa_flow_runs_lead
  ON wa_flow_runs(lead_id, started_at DESC);

ALTER TABLE wa_jobs
  ADD COLUMN IF NOT EXISTS run_id uuid REFERENCES wa_flow_runs(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS flow_step_id uuid REFERENCES wa_flow_steps(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_wa_jobs_run_id ON wa_jobs(run_id) WHERE run_id IS NOT NULL;

DROP TRIGGER IF EXISTS wa_flows_updated_at ON wa_flows;
CREATE TRIGGER wa_flows_updated_at
  BEFORE UPDATE ON wa_flows
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON wa_flows, wa_flow_steps, wa_flow_runs TO app_user;
GRANT SELECT ON wa_flows, wa_flow_steps, wa_flow_runs TO intake_role;
GRANT INSERT, UPDATE ON wa_flow_runs TO intake_role;

ALTER TABLE wa_flows     ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_flow_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_flow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_flows     FORCE ROW LEVEL SECURITY;
ALTER TABLE wa_flow_steps FORCE ROW LEVEL SECURITY;
ALTER TABLE wa_flow_runs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wa_flows_select ON wa_flows;
DROP POLICY IF EXISTS wa_flows_insert ON wa_flows;
DROP POLICY IF EXISTS wa_flows_update ON wa_flows;
DROP POLICY IF EXISTS wa_flows_delete ON wa_flows;
DROP POLICY IF EXISTS wa_flow_steps_select ON wa_flow_steps;
DROP POLICY IF EXISTS wa_flow_steps_insert ON wa_flow_steps;
DROP POLICY IF EXISTS wa_flow_steps_update ON wa_flow_steps;
DROP POLICY IF EXISTS wa_flow_steps_delete ON wa_flow_steps;
DROP POLICY IF EXISTS wa_flow_runs_select ON wa_flow_runs;
DROP POLICY IF EXISTS wa_flow_runs_insert ON wa_flow_runs;
DROP POLICY IF EXISTS wa_flow_runs_update ON wa_flow_runs;

CREATE POLICY wa_flows_select ON wa_flows FOR SELECT USING (
  current_user_role() = 'admin'
  OR (SELECT wa_enabled FROM profiles WHERE id = current_user_id())
);
CREATE POLICY wa_flows_insert ON wa_flows FOR INSERT WITH CHECK (current_user_role() = 'admin');
CREATE POLICY wa_flows_update ON wa_flows FOR UPDATE
  USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');
CREATE POLICY wa_flows_delete ON wa_flows FOR DELETE USING (current_user_role() = 'admin');

CREATE POLICY wa_flow_steps_select ON wa_flow_steps FOR SELECT USING (
  flow_id IN (SELECT id FROM wa_flows)
);
CREATE POLICY wa_flow_steps_insert ON wa_flow_steps FOR INSERT WITH CHECK (current_user_role() = 'admin');
CREATE POLICY wa_flow_steps_update ON wa_flow_steps FOR UPDATE
  USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');
CREATE POLICY wa_flow_steps_delete ON wa_flow_steps FOR DELETE USING (current_user_role() = 'admin');

CREATE POLICY wa_flow_runs_select ON wa_flow_runs FOR SELECT USING (
  lead_id IN (SELECT id FROM leads)
);
CREATE POLICY wa_flow_runs_insert ON wa_flow_runs FOR INSERT WITH CHECK (
  lead_id IN (SELECT id FROM leads)
  AND (
    current_user_role() = 'admin'
    OR (SELECT wa_enabled FROM profiles WHERE id = current_user_id())
  )
);
CREATE POLICY wa_flow_runs_update ON wa_flow_runs FOR UPDATE
  USING (started_by = current_user_id() OR current_user_role() = 'admin')
  WITH CHECK (started_by = current_user_id() OR current_user_role() = 'admin');

COMMIT;
