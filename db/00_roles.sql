-- Phase 0.3 — Database roles
-- Run as the postgres superuser on the VPS.
-- After running this, neither app_user nor intake_role should ever be used
-- to connect as superuser or table owner.

-- App role: non-owner, no BYPASSRLS — RLS is always enforced.
-- Used by DATABASE_URL (the main Next.js connection pool).
CREATE ROLE app_user WITH LOGIN PASSWORD 'REPLACE_WITH_STRONG_PASSWORD';

-- Intake role: allowed to bypass RLS for lead inserts.
-- Used ONLY by DATABASE_URL_INTAKE (the /api/intake endpoint).
CREATE ROLE intake_role WITH LOGIN PASSWORD 'REPLACE_WITH_STRONG_PASSWORD' BYPASSRLS;

-- Grant connect to the database
GRANT CONNECT ON DATABASE finno_crm TO app_user;
GRANT CONNECT ON DATABASE finno_crm TO intake_role;

-- Note: table-level GRANTs (SELECT, INSERT, UPDATE, DELETE) are run in
-- 01_schema.sql after the tables exist. Run that file next.
