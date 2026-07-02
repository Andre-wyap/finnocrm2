-- FINNO CRM — RLS verification matrix (4-tier role model: agent < team_leader < subadmin < admin)
-- Run as the postgres superuser (not app_user):
--   psql -d finno_crm -f db/test-rls.sql
--
-- All test data is created and rolled back in one transaction.
-- Passes print NOTICE lines; failures raise EXCEPTION and abort.

BEGIN;

DO $$
DECLARE
  v_team_a               uuid;
  v_team_b               uuid;
  v_admin_id             uuid;
  v_subadmin_id          uuid;
  v_leader_id            uuid;
  v_agent_id             uuid;
  v_other_agent_id       uuid;
  v_lead_pool_a          uuid;  -- Team A unassigned pool lead
  v_lead_pool_a2         uuid;  -- Team A unassigned pool lead (self-assign test)
  v_lead_mine            uuid;  -- Team A, assigned to v_agent_id
  v_lead_pool_b          uuid;  -- Team B unassigned pool lead
  v_lead_other_assigned  uuid;  -- Team B, assigned to v_other_agent_id
  v_count                int;
BEGIN

  -- ── Seed ──────────────────────────────────────────────────────────────────

  INSERT INTO teams (name) VALUES ('Team A') RETURNING id INTO v_team_a;
  INSERT INTO teams (name) VALUES ('Team B') RETURNING id INTO v_team_b;

  INSERT INTO profiles (firebase_uid, full_name, email, role, team_id)
    VALUES ('rls-admin',    'Test Admin',    'admin@rls.test',    'admin',       NULL)
    RETURNING id INTO v_admin_id;

  INSERT INTO profiles (firebase_uid, full_name, email, role, team_id)
    VALUES ('rls-subadmin', 'Test Subadmin', 'sub@rls.test',      'subadmin',    NULL)
    RETURNING id INTO v_subadmin_id;

  INSERT INTO profiles (firebase_uid, full_name, email, role, team_id)
    VALUES ('rls-leader',   'Test Leader',   'leader@rls.test',   'team_leader', v_team_a)
    RETURNING id INTO v_leader_id;

  INSERT INTO profiles (firebase_uid, full_name, email, role, team_id)
    VALUES ('rls-agent',    'Test Agent',    'agent@rls.test',    'agent',       v_team_a)
    RETURNING id INTO v_agent_id;

  INSERT INTO profiles (firebase_uid, full_name, email, role, team_id)
    VALUES ('rls-other',    'Other Agent',   'other@rls.test',    'agent',       v_team_b)
    RETURNING id INTO v_other_agent_id;

  UPDATE teams SET subadmin_id = v_leader_id WHERE id = v_team_a;

  -- 4 test leads, split across Team A / Team B
  INSERT INTO leads (full_name, mobile, source, status, team_id)
    VALUES ('Pool Lead A', '01111111111', 'rls-test', 'unassigned', v_team_a)
    RETURNING id INTO v_lead_pool_a;

  INSERT INTO leads (full_name, mobile, source, status, team_id)
    VALUES ('Pool Lead A2', '01111111112', 'rls-test', 'unassigned', v_team_a)
    RETURNING id INTO v_lead_pool_a2;

  INSERT INTO leads (full_name, mobile, source, status, team_id, assigned_agent_id)
    VALUES ('My Lead', '01222222222', 'rls-test', 'lead', v_team_a, v_agent_id)
    RETURNING id INTO v_lead_mine;

  INSERT INTO leads (full_name, mobile, source, status, team_id)
    VALUES ('Pool Lead B', '01333333333', 'rls-test', 'unassigned', v_team_b)
    RETURNING id INTO v_lead_pool_b;

  INSERT INTO leads (full_name, mobile, source, status, team_id, assigned_agent_id)
    VALUES ('Other Team Lead', '01444444444', 'rls-test', 'lead', v_team_b, v_other_agent_id)
    RETURNING id INTO v_lead_other_assigned;

  -- ── Admin ─────────────────────────────────────────────────────────────────

  PERFORM set_config('app.current_user_id', v_admin_id::text, true);

  SELECT COUNT(*) INTO v_count FROM leads WHERE source = 'rls-test';
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'FAIL admin leads: expected 5, got %', v_count;
  END IF;
  RAISE NOTICE 'PASS admin sees all % leads', v_count;

  SELECT COUNT(*) INTO v_count FROM profiles WHERE firebase_uid LIKE 'rls-%';
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'FAIL admin profiles: expected 5, got %', v_count;
  END IF;
  RAISE NOTICE 'PASS admin sees all % profiles', v_count;

  -- ── Subadmin (agency-wide — §3) ───────────────────────────────────────────

  PERFORM set_config('app.current_user_id', v_subadmin_id::text, true);

  SELECT COUNT(*) INTO v_count FROM leads WHERE source = 'rls-test';
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'FAIL subadmin leads: expected 5 (agency-wide), got %', v_count;
  END IF;
  RAISE NOTICE 'PASS subadmin sees all % leads (agency-wide)', v_count;

  SELECT COUNT(*) INTO v_count FROM profiles WHERE firebase_uid LIKE 'rls-%';
  IF v_count <> 5 THEN
    RAISE EXCEPTION 'FAIL subadmin profiles: expected 5 (agency-wide), got %', v_count;
  END IF;
  RAISE NOTICE 'PASS subadmin sees all % profiles (agency-wide)', v_count;

  SELECT COUNT(*) INTO v_count FROM teams;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'FAIL subadmin teams: expected 2 (agency-wide), got %', v_count;
  END IF;
  RAISE NOTICE 'PASS subadmin sees all % teams (agency-wide)', v_count;

  -- ── Team leader (bounded to own team — §3/§6) ─────────────────────────────

  PERFORM set_config('app.current_user_id', v_leader_id::text, true);

  SELECT COUNT(*) INTO v_count FROM leads WHERE source = 'rls-test';
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'FAIL team_leader leads: expected 3 (own team pool + own team assigned), got %', v_count;
  END IF;
  RAISE NOTICE 'PASS team_leader sees % leads (own team only)', v_count;

  SELECT COUNT(*) INTO v_count FROM leads WHERE id IN (v_lead_pool_b, v_lead_other_assigned);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL team_leader can see another team''s leads (should be 0)';
  END IF;
  RAISE NOTICE 'PASS team_leader cannot see another team''s leads';

  SELECT COUNT(*) INTO v_count FROM profiles WHERE firebase_uid IN ('rls-leader', 'rls-agent');
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'FAIL team_leader profiles: expected 2 (self + own team), got %', v_count;
  END IF;
  RAISE NOTICE 'PASS team_leader sees % own-team profiles', v_count;

  SELECT COUNT(*) INTO v_count FROM profiles WHERE firebase_uid = 'rls-other';
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL team_leader can see another team''s agent profile (should be 0)';
  END IF;
  RAISE NOTICE 'PASS team_leader cannot see another team''s profile';

  SELECT COUNT(*) INTO v_count FROM teams WHERE id = v_team_a;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL team_leader cannot see own team';
  END IF;
  SELECT COUNT(*) INTO v_count FROM teams WHERE id = v_team_b;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL team_leader can see another team (should be 0)';
  END IF;
  RAISE NOTICE 'PASS team_leader sees only own team';

  -- ── Agent ─────────────────────────────────────────────────────────────────

  PERFORM set_config('app.current_user_id', v_agent_id::text, true);

  SELECT COUNT(*) INTO v_count FROM leads WHERE source = 'rls-test';
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL agent leads: expected 1 (own only), got %', v_count;
  END IF;
  RAISE NOTICE 'PASS agent sees % lead (own only)', v_count;

  SELECT COUNT(*) INTO v_count FROM leads WHERE id = v_lead_pool_a;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL agent can see own-team unassigned pool lead (should be 0)';
  END IF;
  RAISE NOTICE 'PASS agent cannot see the unassigned pool';

  SELECT COUNT(*) INTO v_count FROM leads WHERE id = v_lead_other_assigned;
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

  PERFORM set_config('app.current_user_id', v_admin_id::text, true);
  INSERT INTO activities (lead_id, user_id, type, content)
    VALUES (v_lead_mine, v_admin_id, 'remark', 'test remark');

  PERFORM set_config('app.current_user_id', v_agent_id::text, true);
  SELECT COUNT(*) INTO v_count FROM activities WHERE lead_id = v_lead_mine;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'FAIL agent cannot see activity on own lead (expected 1, got %)', v_count;
  END IF;
  RAISE NOTICE 'PASS agent sees activity on own lead';

  SELECT COUNT(*) INTO v_count FROM activities WHERE lead_id = v_lead_other_assigned;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL agent can see activity on other-team lead (should be 0)';
  END IF;
  RAISE NOTICE 'PASS agent cannot see activity on other-team lead';

  -- ── UPDATE / assignment WITH CHECK ────────────────────────────────────────

  -- Subadmin assigns Team B's pooled lead to a Team A agent — agency-wide,
  -- no team restriction (§9).
  PERFORM set_config('app.current_user_id', v_subadmin_id::text, true);
  UPDATE leads SET assigned_agent_id = v_agent_id, status = 'lead' WHERE id = v_lead_pool_b;
  SELECT COUNT(*) INTO v_count
    FROM activities WHERE lead_id = v_lead_pool_b AND type = 'status_change';
  IF v_count < 1 THEN
    RAISE EXCEPTION 'FAIL status_change activity not logged on subadmin cross-team assignment';
  END IF;
  RAISE NOTICE 'PASS subadmin assigned a pooled lead across teams (audited)';

  -- Team leader assigns their OWN team's pooled lead to their OWN team's
  -- agent — must succeed.
  PERFORM set_config('app.current_user_id', v_leader_id::text, true);
  UPDATE leads SET assigned_agent_id = v_agent_id, status = 'lead' WHERE id = v_lead_pool_a;
  RAISE NOTICE 'PASS team_leader assigned a pooled lead within their own team';

  -- Team leader assigns a pooled lead to THEMSELVES — must succeed (§9: team
  -- leaders may assign to themselves).
  UPDATE leads SET assigned_agent_id = v_leader_id, status = 'lead' WHERE id = v_lead_pool_a2;
  RAISE NOTICE 'PASS team_leader assigned a pooled lead to themselves';

  -- Team leader CANNOT reassign a lead they can see to an agent OUTSIDE their
  -- team — the key new cross-team WITH CHECK rejection for this slice.
  BEGIN
    UPDATE leads SET assigned_agent_id = v_other_agent_id WHERE id = v_lead_pool_a;
    RAISE EXCEPTION 'FAIL team_leader reassigned a lead to another team (should be blocked)';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS team_leader cannot reassign a lead to another team''s agent';
  END;

  -- Team leader cannot even touch a lead outside their own team's visibility
  -- (USING excludes it entirely — 0 rows affected, no exception).
  UPDATE leads SET case_size = 999 WHERE id = v_lead_other_assigned;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FAIL team_leader updated a lead outside their team (should affect 0 rows)';
  END IF;
  RAISE NOTICE 'PASS team_leader update on another team''s lead affects 0 rows';

  -- Agent CANNOT reassign their own lead away
  PERFORM set_config('app.current_user_id', v_agent_id::text, true);
  BEGIN
    UPDATE leads SET assigned_agent_id = v_other_agent_id WHERE id = v_lead_mine;
    RAISE EXCEPTION 'FAIL agent reassigned own lead away (should be blocked)';
  EXCEPTION
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS agent cannot reassign own lead away';
  END;

  -- Agent CAN advance their own lead through the pipeline (and it is audited)
  UPDATE leads SET status = 'follow_up' WHERE id = v_lead_mine;
  SELECT COUNT(*) INTO v_count
    FROM activities WHERE lead_id = v_lead_mine AND type = 'status_change'
                      AND new_value = 'follow_up';
  IF v_count < 1 THEN
    RAISE EXCEPTION 'FAIL agent status change not logged';
  END IF;
  RAISE NOTICE 'PASS agent can advance own lead status (and it is audited)';

  RAISE NOTICE '';
  RAISE NOTICE '✓ All RLS checks passed';

END;
$$;

ROLLBACK;
