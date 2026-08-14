-- OWNER-ONLY PostgreSQL/psql application wrapper. Review the referenced additive
-- migration and owner-041-precheck.sql before running. Codex must not run this
-- against production. This intentionally uses psql's relative include so the
-- reviewed migration is the single SQL source of truth.
\set ON_ERROR_STOP on
\ir supabase/migrations/041_distributor_mapped_status.sql
