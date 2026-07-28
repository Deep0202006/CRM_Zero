WITH required_columns(table_name, column_name) AS (
  VALUES
    ('users','user_id'),('users','is_active'),('user_capabilities','capability_code'),
    ('call_logs','log_id'),('call_logs','lead_id'),('call_logs','client_username'),('call_logs','client_name'),
    ('client_queries','query_id'),('client_queries','problem_status'),('client_queries','resolved_by'),('client_queries','resolved_at'),
    ('mapping_requests','request_id'),('mapping_requests','status'),('mapping_requests','mapped_by'),('mapping_requests','completed_at'),
    ('tasks','task_id'),('tasks','status'),('tasks','assigned_to'),('tasks','completed_at'),
    ('task_status_history','id'),('task_status_history','task_id'),('task_status_history','changed_by'),
    ('allocated_targets','target_id'),('allocated_targets','assigned_to_user_id'),('allocated_targets','is_completed'),
    ('attendance','attendance_id'),('attendance','user_id'),('attendance','date'),
    ('field_visits','visit_id'),('field_visits','selfie_storage_path'),('field_visits','segment_type')
), missing AS (
  SELECT required_columns.* FROM required_columns
  LEFT JOIN information_schema.columns c USING (table_name, column_name)
  WHERE c.column_name IS NULL
), counts AS (
  SELECT
    (SELECT count(*) FROM public.users WHERE COALESCE(is_active, false)) active_users,
    (SELECT count(*) FROM public.call_logs) calls,
    (SELECT count(*) FROM public.client_queries WHERE lower(COALESCE(problem_status::text, '')) = 'resolved') queries,
    (SELECT count(*) FROM public.mapping_requests WHERE lower(COALESCE(status::text, '')) = 'completed') mappings,
    (SELECT count(*) FROM public.tasks WHERE lower(COALESCE(status::text, '')) = 'completed') tasks,
    (SELECT count(*) FROM public.allocated_targets WHERE is_completed) targets,
    (SELECT count(*) FROM public.field_visits) visits
)
SELECT jsonb_build_object(
  'compatible', NOT EXISTS (SELECT 1 FROM missing),
  'missing_columns', COALESCE((SELECT jsonb_agg(to_jsonb(missing)) FROM missing), '[]'::jsonb),
  'migration_030_objects_absent', jsonb_build_object(
    'command_receipts', to_regclass('public.command_receipts') IS NULL,
    'team_activity_events', to_regclass('public.team_activity_events') IS NULL,
    'kpi_v5', to_regprocedure('public.get_team_kpi_daily_v5(date)') IS NULL
  ),
  'source_counts', to_jsonb(counts),
  'status_enum_values', (
    SELECT COALESCE(jsonb_agg(jsonb_build_object('type', t.typname, 'value', e.enumlabel)
      ORDER BY t.typname, e.enumsortorder), '[]'::jsonb)
    FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typname IN ('query_status','task_status_enum')
  ),
  'existing_kpi_functions', (
    SELECT COALESCE(jsonb_agg(p.proname ORDER BY p.proname), '[]'::jsonb)
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname LIKE 'get_team_kpi_daily_v%'
  )
) AS precheck
FROM counts;
