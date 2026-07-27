-- READ ONLY: Verify Team KPI event-ledger migration 028.

-- 1. Objects must exist.
SELECT
  to_regclass('public.team_work_events') AS event_ledger,
  to_regprocedure('public.get_team_kpi_daily_v3(date)') AS report_v3,
  to_regprocedure('public.get_team_kpi_health_v1(date)') AS health_v1;

-- 2. Trigger installation. Twelve trigger definitions are expected (write + delete for six sources).
SELECT event_object_table, trigger_name, action_timing, event_manipulation
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name IN (
    'team_kpi_call_log_event',
    'team_kpi_call_log_delete_event',
    'team_kpi_client_query_event',
    'team_kpi_client_query_delete_event',
    'team_kpi_mapping_request_event',
    'team_kpi_mapping_request_delete_event',
    'team_kpi_task_history_event',
    'team_kpi_task_history_delete_event',
    'team_kpi_task_event',
    'team_kpi_task_delete_event',
    'team_kpi_allocated_target_event',
    'team_kpi_allocated_target_delete_event'
  )
ORDER BY event_object_table, trigger_name, event_manipulation;

-- 3. Backfill reconciliation. Difference must be zero for every source.
WITH expected AS (
  SELECT 'calls'::text AS metric_type, count(*)::bigint AS expected_count
  FROM public.call_logs
  WHERE user_id IS NOT NULL AND timestamp IS NOT NULL
    AND position('→' IN COALESCE(outcome, '')) = 0
  UNION ALL
  SELECT 'client_queries', count(*)
  FROM public.client_queries
  WHERE problem_status = 'Resolved' AND resolved_at IS NOT NULL
    AND COALESCE(resolved_by, assigned_to) IS NOT NULL
  UNION ALL
  SELECT 'mappings', count(*)
  FROM public.mapping_requests
  WHERE status = 'Completed' AND completed_at IS NOT NULL AND mapped_by IS NOT NULL
  UNION ALL
  SELECT 'tasks',
    (SELECT count(*)
     FROM public.task_status_history h
     JOIN public.tasks t ON t.task_id = h.task_id
     WHERE h.new_status = 'Completed' AND h.changed_at IS NOT NULL
       AND COALESCE(h.changed_by, t.assigned_to) IS NOT NULL)
    +
    (SELECT count(*)
     FROM public.tasks t
     WHERE t.status = 'Completed' AND t.completed_at IS NOT NULL AND t.assigned_to IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.task_status_history h
         WHERE h.task_id = t.task_id AND h.new_status = 'Completed'
       ))
    +
    (SELECT count(*)
     FROM public.allocated_targets
     WHERE is_completed = true AND completed_at IS NOT NULL AND assigned_to_user_id IS NOT NULL)
), actual AS (
  SELECT metric_type, count(*)::bigint AS actual_count
  FROM public.team_work_events
  GROUP BY metric_type
)
SELECT
  expected.metric_type,
  expected.expected_count,
  COALESCE(actual.actual_count, 0) AS actual_count,
  expected.expected_count - COALESCE(actual.actual_count, 0) AS difference
FROM expected
LEFT JOIN actual USING (metric_type)
ORDER BY expected.metric_type;

-- 4. Daily retained range and counts, without personal details.
SELECT
  min(business_date) AS first_retained_date,
  max(business_date) AS last_retained_date,
  count(*) AS total_events,
  count(DISTINCT user_id) AS users_with_events
FROM public.team_work_events;

SELECT business_date, metric_type, count(*) AS events
FROM public.team_work_events
GROUP BY business_date, metric_type
ORDER BY business_date DESC, metric_type
LIMIT 100;

-- 5. Privileges. PUBLIC/anon execute must be false; authenticated must be true.
SELECT
  has_function_privilege('public', 'public.get_team_kpi_daily_v3(date)', 'EXECUTE') AS public_execute,
  has_function_privilege('anon', 'public.get_team_kpi_daily_v3(date)', 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', 'public.get_team_kpi_daily_v3(date)', 'EXECUTE') AS authenticated_execute;

-- 6. Realtime publication membership.
SELECT schemaname, tablename
FROM pg_catalog.pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND schemaname = 'public'
  AND tablename = 'team_work_events';

-- Optional only when PostgREST says get_team_kpi_daily_v3 is missing from schema cache:
-- NOTIFY pgrst, 'reload schema';
