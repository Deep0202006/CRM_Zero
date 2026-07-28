WITH required(name) AS (
  VALUES ('users'),('user_capabilities'),('call_logs'),('client_queries'),
    ('mapping_requests'),('mappings'),('tasks'),('task_status_history'),
    ('allocated_targets'),('attendance'),('field_visits'),
    ('command_receipts'),('team_activity_events')
)
SELECT jsonb_build_object(
  'required_tables', count(*),
  'present_tables', count(to_regclass('public.' || name)),
  'missing_tables', COALESCE(jsonb_agg(name) FILTER (WHERE to_regclass('public.' || name) IS NULL), '[]'::jsonb),
  'private_visit_bucket', (
    SELECT COALESCE(bool_and(NOT public), false) FROM storage.buckets WHERE id = 'visits-evidence'
  )
) AS backup_schema_verification
FROM required;
