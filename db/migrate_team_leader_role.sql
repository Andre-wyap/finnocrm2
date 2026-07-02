-- ============================================================================
-- Migration — Phase 5 Slice 3: team_leader role
-- Run as the table owner / superuser (e.g. crm_user) on the VPS.
-- Back up first:
--   docker exec crm-postgres pg_dump -U crm_user -d finno_crm > ~/finno_backup_$(date +%F_%H%M).sql
--
-- Adds the team_leader role, slotted between agent and subadmin (nested
-- authority: agent < team_leader < subadmin < admin — CLAUDE.md §3).
--
-- This is purely additive: no existing profiles are touched. Every current
-- subadmin stays subadmin. team_leader only exists as an option an admin can
-- explicitly assign — to a new user, or to an existing one via Manage Users
-- (Slice 9) or a direct UPDATE in the meantime.
--
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block. Do NOT wrap
-- this file in BEGIN/COMMIT — run it as a plain script.
-- ============================================================================

ALTER TYPE role ADD VALUE IF NOT EXISTS 'team_leader' AFTER 'agent';
