-- FINNO CRM — RLS verification matrix
-- Run as the postgres superuser (not app_user):
--   psql -d finno_crm -f db/test-rls.sql
--
-- All test data is created and rolled back in one transaction.
-- Passes print NOTICE lines; failures raise EXCEPTION and abort.

BEGIN;

DO $$
DECLARE
  v_team_id         uuid;
  v_other_team_id   uuid;
  v_admin_id        uuid;
  v_subadmin_id     uuid;
  v_agent_id        uuid;
  v_other_agent_id  uuid;
  v_lead_unassigned uuid;
  v_lead_mine       uuid;
  v_lead_other      uuid;
  v_count           int;
BEGIN

  -- ── Seed ──────────────────────────────────────────────────────────────────

  INSERT INTO teams (name) VALUES ('Test Team')  RETURNING id INTO v_team_id;
  INSERT INTO teams (name) VALUES ('Other Team') RETURNING id INTO v_other_team_id;

  INSERT INTO profiles (firebase_uid, full_name, email, role, team_id)
    VALUES ('rls-admin',    'Test Admin',    'admin@rls.test',    'admin',    NULL)
    RETURNING id INTO v_admin_id;

  INSERT INTO profiles (firebase_uid, full_name, email, role, team_id)
    VALUES ('rls-subadmin', 'Test Subadmin', 'sub@rls.test',    'subadmin', v_team_id)
    RETURNING id INTO v_subadmin_id;

  INSERT INTO profiles (firebase_uid, full_name, email, role, team_id)
    VALUES ('rls-agent',    'Test Agent',    'agent@rls.test',   'agent',    v_team_id)
    RETURNING id INTO v_agent_id;

  INSERT INTO profiles (firebase_uid, full_name, email, role, team_id)
    VALUES ('rls-other',    'Other Agent',   'other@rls.test',   'agent',    v_other_team_id)
    RETURNING id INTO v_other_agent_id;

  UPDATE teams SET subadmin_id = v_subadmin_id WHERE id = v_team_id;

  -- 3 test leads
  INSERT INTO leads (full_name, mobile, source, status)
    VALUES ('Unassigned Lead', '01111111111', 'rls-test', 'unassigned')
    RETURNING id INTO v_lead_unassigned;

  INSERT INTO leads (full_name, mobile, source, status, assigned_agent_id)
    VALUES ('My Lead', '01222222222', 'rls-test', 'lead', v_agent_id)
    RETURNING id INTO v_lead_mine;

  INSERT INTO leads (full_name, mobile, source, status, assigned_agent_id)
    VALUES ('Other Lead', '01333333333', 'rls-test', 'lead', v_other_agent_id)
    RETURNING id INTO v_lead_other;

  -- ── Admin ─────────────────────────────────────────────────────────────────

  PERFORM set_config('app.current_user_id', v_admin_id::text, true);

  SELECT COUNT(*) INTO v_count FROM leads WHERE source = 'rls-test';
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'FAIL admin leads: expected 3, got %', v_count;
  END IF;
  RAISE NOTICE 'PASS admin sees all % leads', v_count;

  SELECT COUNT(*) INTO v_count FROM profiles WHERE firebase_uid LIKE 'rls-%';
  IF v_count <> 4 THEN
    RAISE EXCEPTION 'FAIL admin profiles: expected 4, got %', v_count;
  END IF;
  RAISE NOTICE 'PASS admin sees all % profiles', v_count;

  -- ── Subadmin ──────────────────────────────────────────────────────────────

  PERFORM set_config('app.current_user_id', v_subadmin_id::text, true);

  SELECT COUNT(*) INTO v_count FROM leads WHERE source = 'rls-test';
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'FAIL subadmin leads: expected 2 (unassigned + team), got %', v_count;
  END IF;
  RAISE NOTICE 'PASS subadmin sees % leads (unassigned + team)', v_count;

  SELECT COUNT(*) INTO v_count FROM leads WHERE id = v_lead_other;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL subadmin can see other-team lead (should be 0)';
  END IF;
  RAISE NOTICE 'PASS subadmin cannot see other-team lead';

  SELECT COUNT(*) INTO v_count
    FROM profiles WHERE firebase_uid IN ('rls-subadmin', 'rls-agent');
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'FAIL subadmin profiles: expected 2, got %', v_count;
  END IF;
  RAISE NOTICE 'PASS subadmin sees % team profiles', v_count;

  -- ── Agent ─────────────────────────────────────────────────────────────────

  PERFORM set_config('app.current_user_id', v_agent_id::text, true);

  SELECT COUNT(*) INTO v_count FROM leads WHERE source = 'rls-test';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL agent leads: expected 1 (own only), got %', v_count;
  END IF;
  RAISE NOTICE 'PASS agent sees % lead (own only)', v_count;

  SELECT COUNT(*) INTO v_count FROM leads WHERE id = v_lead_unassigned;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL agent can see unassigned lead (should be 0)';
  END IF;
  RAISE NOTICE 'PASS agent cannot see unassigned lead';

  SELECT COUNT(*) INTO v_count FROM leads WHERE id = v_lead_other;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL agent can see other-team lead (should be 0)';
  END IF;
  RAISE NOTICE 'PASS agent cannot see other-team lead';

  SELECT COUNT(*) INTO v_count FROM profiles WHERE firebase_uid LIKE 'rls-%';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL agent profiles: expected 1 (self only), got %', v_count;
  END IF;
  RAISE NOTICE 'PASS agent sees only self in profiles';

  -- ── Activities scoped to visible leads ────────────────────────────────────

  -- Insert an activity on the agent's lead (as admin so it succeeds)
  PERFORM set_config('app.current_user_id', v_admin_id::text, true);
  INSERT INTO activities (lead_id, user_id, type, content)
    VALUES (v_lead_mine, v_admin_id, 'remark', 'test remark');

  -- Agent should see that activity
  PERFORM set_config('app.current_user_id', v_agent_id::text, true);
  SELECT COUNT(*) INTO v_count FROM activities WHERE lead_id = v_lead_mine;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL agent cannot see activity on own lead (expected 1, got %)', v_count;
  END IF;
  RAISE NOTICE 'PASS agent sees activity on own lead';

  -- Agent cannot see activity on other-team lead
  SELECT COUNT(*) INTO v_count FROM activities WHERE lead_id = v_lead_other;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL agent can see activity on other-team lead (should be 0)';
  END IF;
  RAISE NOTICE 'PASS agent cannot see activity on other-team lead';

  RAISE NOTICE '';
  RAISE NOTICE '✓ All RLS checks passed';

END;
$$;

ROLLBACK;
