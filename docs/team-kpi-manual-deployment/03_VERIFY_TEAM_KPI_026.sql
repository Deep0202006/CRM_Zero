-- 03_VERIFY_TEAM_KPI_026.sql
-- Verification script to ensure Team KPI migration 026 was applied correctly.
-- Read-only check.

DO \$\$
DECLARE
  func_exists boolean;
  func_is_secdef boolean;
  func_search_path text;
  trigger_count int;
  idx_exists boolean;
BEGIN
  -- 1. Check Function Existence and Details
  SELECT p.prosecdef, pg_get_functiondef(p.oid)
  INTO func_is_secdef, func_search_path
  FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'get_team_kpi_daily'
  AND pg_get_function_identity_arguments(p.oid) = 'target_date date';

  IF func_is_secdef IS NULL THEN
    RAISE EXCEPTION 'ERROR: public.get_team_kpi_daily(date) NOT FOUND.';
  END IF;

  IF NOT func_is_secdef THEN
    RAISE EXCEPTION 'ERROR: Function is not SECURITY DEFINER.';
  END IF;

  IF func_search_path NOT ILIKE '%search_path = pg_catalog, public%' THEN
    RAISE EXCEPTION 'ERROR: Function search_path is missing or incorrect.';
  END IF;

  RAISE NOTICE 'SUCCESS: Function public.get_team_kpi_daily(date) exists and is SECURITY DEFINER with fixed search_path.';

  -- 2. Check Triggers Removed
  SELECT count(*) INTO trigger_count FROM pg_trigger WHERE tgname IN ('on_mapping_request_completed', 'on_client_query_resolved');
  IF trigger_count > 0 THEN
    RAISE EXCEPTION 'ERROR: Legacy snapshot triggers still exist.';
  END IF;

  RAISE NOTICE 'SUCCESS: Legacy snapshot triggers removed.';

  -- 3. Check Index Existence
  SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_tasks_kpi_completed_at_user') INTO idx_exists;
  IF NOT idx_exists THEN
    RAISE EXCEPTION 'ERROR: Expected index idx_tasks_kpi_completed_at_user missing.';
  END IF;

  RAISE NOTICE 'SUCCESS: All verification checks passed.';
END;
\$\$;

-- OPTIONAL: Run this section ONLY IF the application reports that the newly created 
-- RPC is missing from the PostgREST schema cache.
-- NOTIFY pgrst, 'reload schema';
