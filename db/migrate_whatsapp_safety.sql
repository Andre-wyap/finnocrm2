-- ============================================================================
-- WhatsApp automation Slice 4: recoverable worker processing leases
-- Run as crm_user on the VPS after migrate_whatsapp_flows.sql.
-- ============================================================================

BEGIN;

ALTER TABLE wa_jobs
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_wa_jobs_processing_started
  ON wa_jobs(processing_started_at)
  WHERE status = 'processing';

-- Preserve any currently processing job while giving it a finite lease.
UPDATE wa_jobs
SET processing_started_at = now()
WHERE status = 'processing'
  AND processing_started_at IS NULL;

COMMIT;
