-- 01_PRECHECK_READ_ONLY.sql
-- Inspect database state for Team KPI (Migration 026) deployment.
-- This script is completely read-only.
-- EXPECTED:
-- - public.get_team_kpi_daily should NOT exist with a single (date) parameter.
-- - Required source tables (users, tasks, client_queries, etc.) MUST exist.
-- - Existing snapshot triggers should still exist.
-- - If migration 026 has already been applied, DO NOT run the apply script.

DO 
DECLARE
  func_exists boolean;
  tbl text;
  missing_tables text[] := '{}';
  trigger_count int;
BEGIN
  -- Check if function already exists
  SELECT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'get_team_kpi_daily'
    AND pg_get_function_identity_arguments(p.oid) = 'target_date date'
  ) INTO func_exists;
  
  IF func_exists THEN
    RAISE NOTICE 'WARNING: public.get_team_kpi_daily(date) ALREADY EXISTS. Migration 026 may have already been applied.';
  ELSE
    RAISE NOTICE 'SUCCESS: public.get_team_kpi_daily(date) does not exist (Expected).';
  END IF;

  -- Check required tables
  FOREACH tbl IN ARRAY ARRAY['users', 'user_capabilities', 'tasks', 'task_status_history', 'allocated_targets', 'call_logs', 'client_queries', 'mapping_requests']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = tbl) THEN
      missing_tables := array_append(missing_tables, tbl);
    END IF;
  END LOOP;
  
  IF array_length(missing_tables, 1) > 0 THEN
    RAISE EXCEPTION 'ERROR: Missing required tables: %', missing_tables;
  ELSE
    RAISE NOTICE 'SUCCESS: All required source tables exist.';
  END IF;

  -- Check snapshot triggers
  SELECT count(*) INTO trigger_count FROM pg_trigger WHERE tgname IN ('on_mapping_request_completed', 'on_client_query_resolved');
  RAISE NOTICE 'INFO: Found % legacy snapshot triggers (Expected > 0 if not yet applied, 0 if applied).', trigger_count;
END;
;
