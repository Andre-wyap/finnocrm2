-- ============================================================================
-- WhatsApp automation Slice 2: media, templates, one-off queue, activity type
-- Run as crm_user on the VPS. Back up finno_crm first.
--
-- activity_type is altered outside an explicit transaction because PostgreSQL
-- enum additions must be committed before the new value can be used.
-- ============================================================================

ALTER TYPE activity_type ADD VALUE IF NOT EXISTS 'wa_message';

DO $$ BEGIN
  CREATE TYPE wa_job_status AS ENUM ('pending', 'processing', 'sent', 'failed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS wa_media (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name   text NOT NULL,
  mime_type   text NOT NULL CHECK (
    mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')
  ),
  size_bytes  integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  data        bytea NOT NULL CHECK (octet_length(data) = size_bytes),
  uploaded_by uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wa_templates (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
  body       text NOT NULL CHECK (length(trim(body)) > 0),
  media_id   uuid REFERENCES wa_media(id) ON DELETE SET NULL,
  is_active  boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS wa_templates_updated_at ON wa_templates;
CREATE TRIGGER wa_templates_updated_at
  BEFORE UPDATE ON wa_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE IF NOT EXISTS wa_jobs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
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

CREATE INDEX IF NOT EXISTS idx_wa_jobs_due
  ON wa_jobs(status, run_at)
  WHERE status = 'pending';

GRANT SELECT, INSERT, UPDATE, DELETE ON wa_media, wa_templates TO app_user;

-- The worker and the enqueue endpoint use the existing privileged intake
-- connection, but only receive the exact table operations needed here.
GRANT SELECT ON leads, profiles, wa_instances, wa_templates, wa_media TO intake_role;
GRANT SELECT, INSERT, UPDATE ON wa_jobs TO intake_role;
GRANT INSERT ON activities TO intake_role;

ALTER TABLE wa_media     ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_jobs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE wa_media     FORCE ROW LEVEL SECURITY;
ALTER TABLE wa_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE wa_jobs      FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wa_media_select ON wa_media;
DROP POLICY IF EXISTS wa_media_insert ON wa_media;
DROP POLICY IF EXISTS wa_media_update ON wa_media;
DROP POLICY IF EXISTS wa_media_delete ON wa_media;
CREATE POLICY wa_media_select ON wa_media FOR SELECT USING (
  current_user_role() = 'admin'
  OR (SELECT wa_enabled FROM profiles WHERE id = current_user_id())
);
CREATE POLICY wa_media_insert ON wa_media FOR INSERT WITH CHECK (
  current_user_role() = 'admin'
);
CREATE POLICY wa_media_update ON wa_media FOR UPDATE
  USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');
CREATE POLICY wa_media_delete ON wa_media FOR DELETE USING (
  current_user_role() = 'admin'
);

DROP POLICY IF EXISTS wa_templates_select ON wa_templates;
DROP POLICY IF EXISTS wa_templates_insert ON wa_templates;
DROP POLICY IF EXISTS wa_templates_update ON wa_templates;
DROP POLICY IF EXISTS wa_templates_delete ON wa_templates;
CREATE POLICY wa_templates_select ON wa_templates FOR SELECT USING (
  current_user_role() = 'admin'
  OR (SELECT wa_enabled FROM profiles WHERE id = current_user_id())
);
CREATE POLICY wa_templates_insert ON wa_templates FOR INSERT WITH CHECK (
  current_user_role() = 'admin'
);
CREATE POLICY wa_templates_update ON wa_templates FOR UPDATE
  USING (current_user_role() = 'admin')
  WITH CHECK (current_user_role() = 'admin');
CREATE POLICY wa_templates_delete ON wa_templates FOR DELETE USING (
  current_user_role() = 'admin'
);

-- Deliberately no app_user policies on wa_jobs. Queue access is worker-only.
