WITH source AS (
  SELECT 'calls' type, (timestamp AT TIME ZONE 'Asia/Kolkata')::date day, count(*) count
  FROM public.call_logs WHERE user_id IS NOT NULL AND timestamp IS NOT NULL
    AND COALESCE(outcome::text, '') !~* '^\s*(\[.*\]\s*(→|->)|pipeline\s+stage)' GROUP BY day
  UNION ALL SELECT 'queries', (resolved_at AT TIME ZONE 'Asia/Kolkata')::date, count(*)
  FROM public.client_queries WHERE lower(COALESCE(problem_status::text, ''))='resolved'
    AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL GROUP BY 2
  UNION ALL SELECT 'mappings', (completed_at AT TIME ZONE 'Asia/Kolkata')::date, count(*)
  FROM public.mapping_requests WHERE lower(COALESCE(status::text, ''))='completed'
    AND mapped_by IS NOT NULL AND completed_at IS NOT NULL GROUP BY 2
  UNION ALL SELECT 'tasks', (completed_at AT TIME ZONE 'Asia/Kolkata')::date, count(*)
  FROM public.tasks WHERE lower(COALESCE(status::text, ''))='completed'
    AND assigned_to IS NOT NULL AND completed_at IS NOT NULL GROUP BY 2
  UNION ALL SELECT 'targets', (completed_at AT TIME ZONE 'Asia/Kolkata')::date, count(*)
  FROM public.allocated_targets WHERE is_completed AND assigned_to_user_id IS NOT NULL
    AND completed_at IS NOT NULL GROUP BY 2
), events AS (
  SELECT CASE event_type
    WHEN 'call_completed' THEN 'calls' WHEN 'client_query_resolved' THEN 'queries'
    WHEN 'mapping_completed' THEN 'mappings' WHEN 'task_completed' THEN 'tasks'
    WHEN 'allocated_target_completed' THEN 'targets' END type,
    business_date day, count(*) count
  FROM public.team_activity_events GROUP BY 1,2
)
SELECT jsonb_build_object(
  'daily_differences', COALESCE(jsonb_agg(jsonb_build_object(
    'type', COALESCE(source.type, events.type), 'date', COALESCE(source.day, events.day),
    'source', COALESCE(source.count,0), 'events', COALESCE(events.count,0),
    'difference', COALESCE(source.count,0)-COALESCE(events.count,0)
  ) ORDER BY COALESCE(source.day,events.day) DESC, COALESCE(source.type,events.type)), '[]'::jsonb),
  'visit_count', (SELECT count(*) FROM public.field_visits)
) AS reconciliation
FROM source FULL JOIN events USING (type, day);
