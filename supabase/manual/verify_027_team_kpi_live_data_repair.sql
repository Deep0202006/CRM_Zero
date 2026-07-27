-- Read-only verification for 027_team_kpi_live_data_repair.sql.
-- Run in Supabase SQL Editor after applying migration 027. Do not insert test data.

-- 1. Function identity and security settings.
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  p.prosecdef AS security_definer,
  p.proconfig AS function_settings
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'get_team_kpi_daily';

-- 2. Execution privileges. Expected: authenticated=true, anon=false, public=false.
SELECT
  has_function_privilege('authenticated', 'public.get_team_kpi_daily(date)', 'EXECUTE') AS authenticated_execute,
  has_function_privilege('anon', 'public.get_team_kpi_daily(date)', 'EXECUTE') AS anon_execute,
  has_function_privilege('public', 'public.get_team_kpi_daily(date)', 'EXECUTE') AS public_execute;

-- 3. Required source columns. Every row below should be present.
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (table_name, column_name) IN (
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
ORDER BY table_name, column_name;

-- 4. Safe aggregate-only source availability for the current India date.
WITH bounds AS (
  SELECT
    ((now() AT TIME ZONE 'Asia/Kolkata')::date)::timestamp AT TIME ZONE 'Asia/Kolkata' AS starts_at,
    (((now() AT TIME ZONE 'Asia/Kolkata')::date + 1))::timestamp AT TIME ZONE 'Asia/Kolkata' AS ends_at
)
SELECT 'active_users' AS source, count(*)::bigint AS record_count
FROM public.users
WHERE lower(COALESCE(is_active::text, 'false')) IN ('1', 'true', 't')
UNION ALL
SELECT 'calls', count(*) FROM public.call_logs c, bounds b
WHERE c.timestamp >= b.starts_at AND c.timestamp < b.ends_at AND position('→' IN COALESCE(c.outcome, '')) = 0
UNION ALL
SELECT 'resolved_queries', count(*) FROM public.client_queries q, bounds b
WHERE q.problem_status = 'Resolved' AND q.resolved_at >= b.starts_at AND q.resolved_at < b.ends_at
UNION ALL
SELECT 'completed_mappings', count(*) FROM public.mapping_requests m, bounds b
WHERE m.status = 'Completed' AND m.completed_at >= b.starts_at AND m.completed_at < b.ends_at
UNION ALL
SELECT 'completed_tasks', count(*) FROM public.tasks t, bounds b
WHERE t.status = 'Completed' AND t.completed_at >= b.starts_at AND t.completed_at < b.ends_at
UNION ALL
SELECT 'completed_targets', count(*) FROM public.allocated_targets a, bounds b
WHERE a.is_completed = true AND a.completed_at >= b.starts_at AND a.completed_at < b.ends_at;

-- Optional only when the application reports a PostgREST schema-cache miss:
-- NOTIFY pgrst, 'reload schema';
