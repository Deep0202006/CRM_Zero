-- Read-only precheck for 027_team_kpi_live_data_repair.sql.
-- Run this first in the Supabase SQL Editor. Do not run the migration when any
-- required column is missing or when an unexpected function signature exists.

-- 1. Existing Team KPI function signatures, if any.
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  p.prosecdef AS security_definer,
  p.proconfig AS function_settings
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'get_team_kpi_daily'
ORDER BY arguments;

-- 2. Required columns. Expected count: 33 rows.
WITH required(table_name, column_name) AS (
  VALUES
    ('users', 'user_id'), ('users', 'name'), ('users', 'is_active'),
    ('user_capabilities', 'user_id'), ('user_capabilities', 'capability_code'),
    ('capabilities', 'code'), ('capabilities', 'label'),
    ('call_logs', 'log_id'), ('call_logs', 'user_id'), ('call_logs', 'timestamp'), ('call_logs', 'outcome'),
    ('client_queries', 'query_id'), ('client_queries', 'assigned_to'), ('client_queries', 'resolved_by'), ('client_queries', 'resolved_at'), ('client_queries', 'problem_status'),
    ('mapping_requests', 'request_id'), ('mapping_requests', 'mapped_by'), ('mapping_requests', 'completed_at'), ('mapping_requests', 'status'),
    ('tasks', 'task_id'), ('tasks', 'assigned_to'), ('tasks', 'completed_at'), ('tasks', 'status'),
    ('task_status_history', 'id'), ('task_status_history', 'task_id'), ('task_status_history', 'changed_by'), ('task_status_history', 'changed_at'), ('task_status_history', 'new_status'),
    ('allocated_targets', 'target_id'), ('allocated_targets', 'assigned_to_user_id'), ('allocated_targets', 'completed_at'), ('allocated_targets', 'is_completed')
)
SELECT
  required.table_name,
  required.column_name,
  CASE WHEN columns.column_name IS NULL THEN 'MISSING' ELSE 'OK' END AS status,
  columns.data_type
FROM required
LEFT JOIN information_schema.columns columns
  ON columns.table_schema = 'public'
 AND columns.table_name = required.table_name
 AND columns.column_name = required.column_name
ORDER BY required.table_name, required.column_name;

-- 3. Existing narrow KPI indexes. Missing rows are safe; migration 027 creates
-- them idempotently.
SELECT schemaname, tablename, indexname, indexdef
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

-- 4. Realtime publication membership. Missing source tables are added
-- idempotently by migration 027 when the publication exists.
SELECT schemaname, tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND schemaname = 'public'
  AND tablename IN (
    'users', 'user_capabilities', 'tasks', 'task_status_history',
    'allocated_targets', 'call_logs', 'client_queries', 'mapping_requests'
  )
ORDER BY tablename;

-- 5. Aggregate-only retained data range. This intentionally exposes no names or
-- business record contents. Dates before the minimum timestamps cannot be
-- reconstructed by Team KPI unless an external backup is restored.
SELECT 'call_logs' AS source, min(timestamp) AS earliest, max(timestamp) AS latest, count(*)::bigint AS rows FROM public.call_logs
UNION ALL
SELECT 'client_queries', min(resolved_at), max(resolved_at), count(*) FILTER (WHERE resolved_at IS NOT NULL) FROM public.client_queries
UNION ALL
SELECT 'mapping_requests', min(completed_at), max(completed_at), count(*) FILTER (WHERE completed_at IS NOT NULL) FROM public.mapping_requests
UNION ALL
SELECT 'tasks', min(completed_at), max(completed_at), count(*) FILTER (WHERE completed_at IS NOT NULL) FROM public.tasks
UNION ALL
SELECT 'task_status_history', min(changed_at), max(changed_at), count(*) FILTER (WHERE new_status = 'Completed') FROM public.task_status_history
UNION ALL
SELECT 'allocated_targets', min(completed_at), max(completed_at), count(*) FILTER (WHERE completed_at IS NOT NULL) FROM public.allocated_targets;
