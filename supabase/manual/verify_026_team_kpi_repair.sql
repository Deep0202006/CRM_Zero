-- Development/staging verification for 026_team_kpi_repair.sql.
-- Replace placeholder UUIDs only with safe test users. Do not run destructive
-- statements against production. The transaction is rolled back.

BEGIN;

-- 1. Confirm the function and execution grants.
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  p.prosecdef AS security_definer,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'get_team_kpi_daily';

-- 2. Confirm the new mapping attribution column and KPI indexes.
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'mapping_requests'
  AND column_name = 'requested_by';

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'idx_tasks_kpi_completed_at_user',
    'idx_task_status_history_kpi_completed_at_user',
    'idx_client_queries_kpi_resolved_at_user',
    'idx_mapping_requests_kpi_completed_at_user',
    'idx_call_logs_kpi_timestamp_user',
    'idx_allocated_targets_kpi_completed_at_user'
  )
ORDER BY indexname;

-- 3. Confirm realtime publication coverage.
SELECT tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND schemaname = 'public'
  AND tablename IN (
    'users', 'user_capabilities', 'tasks', 'task_status_history',
    'allocated_targets', 'call_logs', 'client_queries', 'mapping_requests'
  )
ORDER BY tablename;

-- 4. RPC authorization and result test.
-- Replace with a safe ADMIN auth user UUID before running this block.
-- SELECT set_config('request.jwt.claim.sub', '<ADMIN_AUTH_UUID>', true);
-- SELECT set_config('request.jwt.claim.role', 'authenticated', true);
-- SELECT public.get_team_kpi_daily(current_date);

-- 5. Raw-source comparison template for a chosen India date.
-- Replace DATE '2026-07-27' with the test date.
WITH bounds AS (
  SELECT
    DATE '2026-07-27'::timestamp AT TIME ZONE 'Asia/Kolkata' AS starts_at,
    (DATE '2026-07-27' + 1)::timestamp AT TIME ZONE 'Asia/Kolkata' AS ends_at
)
SELECT 'calls' AS metric, count(*) AS total
FROM public.call_logs c CROSS JOIN bounds b
WHERE c.timestamp >= b.starts_at AND c.timestamp < b.ends_at
  AND position('→' IN COALESCE(c.outcome, '')) = 0
UNION ALL
SELECT 'queries', count(*)
FROM public.client_queries q CROSS JOIN bounds b
WHERE q.problem_status = 'Resolved'
  AND q.resolved_at >= b.starts_at AND q.resolved_at < b.ends_at
UNION ALL
SELECT 'mappings', count(*)
FROM public.mapping_requests m CROSS JOIN bounds b
WHERE m.status = 'Completed'
  AND m.completed_at >= b.starts_at AND m.completed_at < b.ends_at
UNION ALL
SELECT 'normal task completion events', count(*)
FROM public.task_status_history h CROSS JOIN bounds b
WHERE h.new_status = 'Completed'
  AND h.changed_at >= b.starts_at AND h.changed_at < b.ends_at
UNION ALL
SELECT 'allocated targets', count(*)
FROM public.allocated_targets t CROSS JOIN bounds b
WHERE t.is_completed = true
  AND t.completed_at >= b.starts_at AND t.completed_at < b.ends_at;

ROLLBACK;
