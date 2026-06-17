-- Slice A migration — run against the live DB as the superuser / table owner.
-- Safe to run once; each statement is idempotent where possible.
-- Back up the database before running.

BEGIN;

-- ─── 1. lead_status enum: add 'follow_up' before 'potential' ─────────────────
-- ALTER TYPE … ADD VALUE cannot run inside a transaction in PG < 12.
-- In PG 12+ it can, but only if the type is not used in a table default —
-- here it is, so we commit after this block and continue in a new transaction.
COMMIT;

ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'follow_up' BEFORE 'potential';

BEGIN;

-- ─── 2. activity_type enum: remove 'follow_up' ───────────────────────────────
-- Postgres cannot DROP a value from an enum directly.
-- We rename the old type, create the new one, migrate rows, then drop the old.

-- Only run if 'follow_up' still exists in the enum.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'activity_type' AND e.enumlabel = 'follow_up'
  ) THEN
    -- Rename old type
    ALTER TYPE activity_type RENAME TO activity_type_old;

    -- Create new type without 'follow_up'
    CREATE TYPE activity_type AS ENUM ('remark', 'call', 'status_change', 'field_change', 'assignment');

    -- Migrate any existing 'follow_up' rows to 'remark' (historical, safe fallback)
    ALTER TABLE activities ALTER COLUMN type DROP DEFAULT;
    UPDATE activities SET type = 'remark'::text WHERE type::text = 'follow_up';
    ALTER TABLE activities
      ALTER COLUMN type TYPE activity_type USING type::text::activity_type;

    DROP TYPE activity_type_old;
  END IF;
END;
$$;

-- ─── 3. leads: drop next_follow_up_at ────────────────────────────────────────
ALTER TABLE leads DROP COLUMN IF EXISTS next_follow_up_at;

-- Drop the now-unused index (harmless if already gone)
DROP INDEX IF EXISTS idx_leads_next_follow_up;

-- ─── 4. activities: drop follow_up_at ────────────────────────────────────────
ALTER TABLE activities DROP COLUMN IF EXISTS follow_up_at;

-- ─── 5. RLS: drop and recreate leads policies ────────────────────────────────
DROP POLICY IF EXISTS leads_select ON leads;
DROP POLICY IF EXISTS leads_update ON leads;

CREATE POLICY leads_select ON leads FOR SELECT USING (
  CASE current_user_role()
    WHEN 'admin'    THEN true
    WHEN 'subadmin' THEN (
      assigned_agent_id = current_user_id()
      OR status = 'unassigned'
      OR assigned_agent_id IN (SELECT id FROM profiles WHERE team_id = current_user_team())
    )
    WHEN 'agent'    THEN assigned_agent_id = current_user_id()
    ELSE false
  END
);

CREATE POLICY leads_update ON leads FOR UPDATE USING (
  CASE current_user_role()
    WHEN 'admin'    THEN true
    WHEN 'subadmin' THEN (
      assigned_agent_id = current_user_id()
      OR status = 'unassigned'
      OR assigned_agent_id IN (SELECT id FROM profiles WHERE team_id = current_user_team())
    )
    WHEN 'agent'    THEN assigned_agent_id = current_user_id()
    ELSE false
  END
);

-- ─── 6. RLS: drop and recreate profiles_update policy ────────────────────────
DROP POLICY IF EXISTS profiles_update ON profiles;

CREATE POLICY profiles_update ON profiles FOR UPDATE
  USING (id = current_user_id() OR current_user_role() = 'admin')
  WITH CHECK (
    current_user_role() = 'admin'
    OR (
      id = current_user_id()
      AND role = (SELECT role FROM profiles WHERE id = current_user_id())
      AND (team_id IS NOT DISTINCT FROM (SELECT team_id FROM profiles WHERE id = current_user_id()))
    )
  );

-- ─── 7. Rebuild log_lead_changes trigger (drop next_follow_up_at block) ───────
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
  RETURN NEW;
END;
$$;

COMMIT;
