-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: highlight one remark per lead for the list view
--
-- Adds leads.highlighted_activity_id — a pointer to a single `remark` activity
-- that the agent has flagged as important. The Leads list surfaces its text next
-- to the lead so key context ("Appointment 3pm Fri", etc.) is visible without
-- opening the card. ON DELETE SET NULL so deleting the remark just clears the
-- highlight. The change-log trigger (log_lead_changes) only audits the customer
-- fields, so toggling this column writes no activity noise.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS highlighted_activity_id uuid
    REFERENCES activities(id) ON DELETE SET NULL;
