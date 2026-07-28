SELECT jsonb_build_object(
  'active_users', (SELECT count(*) FROM public.users WHERE COALESCE(is_active, false)),
  'calls', (SELECT count(*) FROM public.call_logs),
  'resolved_queries', (SELECT count(*) FROM public.client_queries WHERE lower(COALESCE(problem_status::text, '')) = 'resolved'),
  'completed_mappings', (SELECT count(*) FROM public.mapping_requests WHERE lower(COALESCE(status::text, '')) = 'completed'),
  'completed_tasks', (SELECT count(*) FROM public.tasks WHERE lower(COALESCE(status::text, '')) = 'completed'),
  'completed_targets', (SELECT count(*) FROM public.allocated_targets WHERE is_completed),
  'visits', (SELECT count(*) FROM public.field_visits),
  'kpi_events', (SELECT count(*) FROM public.team_activity_events),
  'command_receipts', (SELECT count(*) FROM public.command_receipts),
  'invalid_evidence_paths', (
    SELECT count(*) FROM public.field_visits
    WHERE selfie_storage_path IS NOT NULL
      AND selfie_storage_path <> user_id::text || '/' || visit_date::text || '/' || visit_id::text || '.jpg'
  )
) AS restored_data_verification;
