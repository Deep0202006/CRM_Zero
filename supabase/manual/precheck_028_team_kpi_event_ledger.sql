-- READ ONLY: Team KPI migration 028 precheck.
-- Run in Supabase SQL Editor before applying migration 028.

-- 1. Required source columns. Every row must say PRESENT.
WITH required_columns(table_name, column_name) AS (
  VALUES
    ('users', 'user_id'), ('users', 'name'), ('users', 'is_active'),
    ('user_capabilities', 'user_id'), ('user_capabilities', 'capability_code'),
    ('capabilities', 'code'), ('capabilities', 'label'),
    ('call_logs', 'log_id'), ('call_logs', 'user_id'), ('call_logs', 'timestamp'), ('call_logs', 'outcome'),
    ('client_queries', 'query_id'), ('client_queries', 'assigned_to'), ('client_queries', 'resolved_by'),
    ('client_queries', 'resolved_at'), ('client_queries', 'problem_status'),
    ('mapping_requests', 'request_id'), ('mapping_requests', 'mapped_by'),
    ('mapping_requests', 'completed_at'), ('mapping_requests', 'status'),
    ('tasks', 'task_id'), ('tasks', 'assigned_to'), ('tasks', 'completed_at'), ('tasks', 'status'),
    ('task_status_history', 'id'), ('task_status_history', 'task_id'),
    ('task_status_history', 'changed_by'), ('task_status_history', 'changed_at'),
    ('task_status_history', 'new_status'),
    ('allocated_targets', 'target_id'), ('allocated_targets', 'assigned_to_user_id'),
    ('allocated_targets', 'completed_at'), ('allocated_targets', 'is_completed')
)
SELECT
  required_columns.table_name,
  required_columns.column_name,
  CASE WHEN existing.column_name IS NULL THEN 'MISSING' ELSE 'PRESENT' END AS status,
  existing.data_type,
  existing.udt_name
FROM required_columns
LEFT JOIN information_schema.columns existing
  ON existing.table_schema = 'public'
 AND existing.table_name = required_columns.table_name
 AND existing.column_name = required_columns.column_name
ORDER BY required_columns.table_name, required_columns.column_name;

-- 2. Current Team KPI object state.
SELECT
  to_regclass('public.team_work_events') AS event_ledger,
  to_regprocedure('public.get_team_kpi_daily_v3(date)') AS report_v3,
  to_regprocedure('public.get_team_kpi_health_v1(date)') AS health_v1,
  to_regprocedure('public.get_team_kpi_daily(date)') AS legacy_report;

-- 3. Active user and retained source counts. These contain counts only, not business records.
SELECT 'active_users' AS source, count(*)::bigint AS retained_rows
FROM public.users
WHERE lower(COALESCE(is_active::text, 'false')) IN ('1', 'true', 't')
UNION ALL
SELECT 'real_call_logs', count(*)
FROM public.call_logs
WHERE user_id IS NOT NULL AND timestamp IS NOT NULL
  AND position('→' IN COALESCE(outcome, '')) = 0
UNION ALL
SELECT 'resolved_client_queries', count(*)
FROM public.client_queries
WHERE problem_status = 'Resolved' AND resolved_at IS NOT NULL
  AND COALESCE(resolved_by, assigned_to) IS NOT NULL
UNION ALL
SELECT 'completed_mappings', count(*)
FROM public.mapping_requests
WHERE status = 'Completed' AND completed_at IS NOT NULL AND mapped_by IS NOT NULL
UNION ALL
SELECT 'task_completion_history', count(*)
FROM public.task_status_history h
JOIN public.tasks t ON t.task_id = h.task_id
WHERE h.new_status = 'Completed' AND h.changed_at IS NOT NULL
  AND COALESCE(h.changed_by, t.assigned_to) IS NOT NULL
UNION ALL
SELECT 'legacy_completed_tasks', count(*)
FROM public.tasks t
WHERE t.status = 'Completed' AND t.completed_at IS NOT NULL AND t.assigned_to IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.task_status_history h
    WHERE h.task_id = t.task_id AND h.new_status = 'Completed'
  )
UNION ALL
SELECT 'completed_allocated_targets', count(*)
FROM public.allocated_targets
WHERE is_completed = true AND completed_at IS NOT NULL AND assigned_to_user_id IS NOT NULL;

-- 4. Confirm the current operator has an admin capability row. The result should be true
-- for the application account that will open Team KPI; SQL Editor itself has no auth.uid().
SELECT capability_code, count(*) AS assigned_users
FROM public.user_capabilities
WHERE capability_code = 'admin'
GROUP BY capability_code;
