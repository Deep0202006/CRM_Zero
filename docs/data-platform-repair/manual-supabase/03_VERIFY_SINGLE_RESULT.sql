SELECT jsonb_build_object(
  'command_receipts', jsonb_build_object(
    'table', to_regclass('public.command_receipts') IS NOT NULL,
    'rls', (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.command_receipts'))
  ),
  'commands', jsonb_build_object(
    'call', to_regprocedure('public.log_call_v1(uuid,uuid,uuid,text,text,timestamptz,text,text,timestamptz)') IS NOT NULL,
    'query', to_regprocedure('public.resolve_client_query_v1(uuid,uuid,timestamptz,text)') IS NOT NULL,
    'mapping', to_regprocedure('public.complete_mapping_v1(uuid,uuid,timestamptz)') IS NOT NULL,
    'task', to_regprocedure('public.complete_task_v1(uuid,uuid,timestamptz)') IS NOT NULL,
    'target', to_regprocedure('public.complete_allocated_target_v1(uuid,uuid,timestamptz)') IS NOT NULL,
    'visit', to_regprocedure('public.create_field_visit_v1(uuid,uuid,text,date,timestamptz,double precision,double precision,numeric,timestamptz,text,text,timestamptz,text,text,text,text,uuid,text,text,date)') IS NOT NULL
  ),
  'reporting', jsonb_build_object(
    'events', to_regclass('public.team_activity_events') IS NOT NULL,
    'kpi', to_regprocedure('public.get_team_kpi_daily_v5(date)') IS NOT NULL,
    'visits', to_regprocedure('public.get_admin_visit_report_v1(date,date,uuid,text,text[],text,integer,integer,boolean)') IS NOT NULL,
    'health', to_regprocedure('public.get_admin_data_health_v1()') IS NOT NULL
  ),
  'realtime', jsonb_build_object(
    'team_activity_events', EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='team_activity_events'),
    'field_visits', EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='field_visits')
  ),
  'private_evidence', (SELECT NOT public FROM storage.buckets WHERE id='visits-evidence'),
  'active_users', (SELECT count(*) FROM public.users WHERE COALESCE(is_active, false)),
  'recent_events', (SELECT count(*) FROM public.team_activity_events WHERE business_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date - 7)
) AS verification;
