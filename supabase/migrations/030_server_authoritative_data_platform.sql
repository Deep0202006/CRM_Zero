BEGIN;

CREATE TABLE public.team_activity_events (
  event_key text PRIMARY KEY,
  event_type text NOT NULL CHECK (event_type IN (
    'call_completed', 'client_query_resolved', 'mapping_completed',
    'task_completed', 'allocated_target_completed'
  )),
  source_table text NOT NULL,
  source_record_id text NOT NULL,
  performed_by uuid NOT NULL REFERENCES public.users(user_id),
  occurred_at timestamptz NOT NULL,
  business_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.team_activity_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY team_activity_events_admin_read ON public.team_activity_events
FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.user_capabilities AS capability
    WHERE capability.user_id = auth.uid() AND capability.capability_code = 'admin'
  )
);
CREATE INDEX team_activity_events_date_actor_idx
  ON public.team_activity_events (business_date, performed_by);

CREATE FUNCTION public.capture_team_activity_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $function$
DECLARE
  event_key_value text;
  event_type_value text;
  record_id_value text;
  actor_value uuid;
  occurred_value timestamptz;
BEGIN
  IF TG_TABLE_NAME = 'call_logs' THEN
    IF NEW.user_id IS NULL OR NEW.timestamp IS NULL
       OR COALESCE(NEW.outcome::text, '') ~* '^\s*(\[.*\]\s*(→|->)|pipeline\s+stage)' THEN
      RETURN NEW;
    END IF;
    event_key_value := 'call:' || NEW.log_id::text;
    event_type_value := 'call_completed';
    record_id_value := NEW.log_id::text;
    actor_value := NEW.user_id;
    occurred_value := NEW.timestamp;
  ELSIF TG_TABLE_NAME = 'client_queries' THEN
    IF lower(COALESCE(NEW.problem_status::text, '')) <> 'resolved'
       OR NEW.resolved_at IS NULL OR NEW.resolved_by IS NULL THEN RETURN NEW; END IF;
    event_key_value := 'query:' || NEW.query_id::text;
    event_type_value := 'client_query_resolved';
    record_id_value := NEW.query_id::text;
    actor_value := NEW.resolved_by;
    occurred_value := NEW.resolved_at;
  ELSIF TG_TABLE_NAME = 'mapping_requests' THEN
    IF lower(COALESCE(NEW.status::text, '')) NOT IN ('completed', 'resolved')
       OR NEW.completed_at IS NULL OR NEW.mapped_by IS NULL THEN RETURN NEW; END IF;
    event_key_value := 'mapping:' || NEW.request_id::text;
    event_type_value := 'mapping_completed';
    record_id_value := NEW.request_id::text;
    actor_value := NEW.mapped_by;
    occurred_value := NEW.completed_at;
  ELSIF TG_TABLE_NAME = 'tasks' THEN
    IF lower(COALESCE(NEW.status::text, '')) <> 'completed'
       OR NEW.completed_at IS NULL OR NEW.assigned_to IS NULL THEN RETURN NEW; END IF;
    event_key_value := 'task:' || NEW.task_id::text;
    event_type_value := 'task_completed';
    record_id_value := NEW.task_id::text;
    actor_value := NEW.assigned_to;
    occurred_value := NEW.completed_at;
  ELSIF TG_TABLE_NAME = 'allocated_targets' THEN
    IF NOT COALESCE(NEW.is_completed, false)
       OR NEW.completed_at IS NULL OR NEW.assigned_to_user_id IS NULL THEN RETURN NEW; END IF;
    event_key_value := 'allocated-target:' || NEW.target_id::text;
    event_type_value := 'allocated_target_completed';
    record_id_value := NEW.target_id::text;
    actor_value := NEW.assigned_to_user_id;
    occurred_value := NEW.completed_at;
  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.team_activity_events (
    event_key, event_type, source_table, source_record_id,
    performed_by, occurred_at, business_date
  ) VALUES (
    event_key_value, event_type_value, TG_TABLE_NAME, record_id_value,
    actor_value, occurred_value, (occurred_value AT TIME ZONE 'Asia/Kolkata')::date
  ) ON CONFLICT (event_key) DO NOTHING;
  RETURN NEW;
END
$function$;

CREATE TRIGGER team_activity_call AFTER INSERT OR UPDATE ON public.call_logs
FOR EACH ROW EXECUTE FUNCTION public.capture_team_activity_event();
CREATE TRIGGER team_activity_query AFTER INSERT OR UPDATE ON public.client_queries
FOR EACH ROW EXECUTE FUNCTION public.capture_team_activity_event();
CREATE TRIGGER team_activity_mapping AFTER INSERT OR UPDATE ON public.mapping_requests
FOR EACH ROW EXECUTE FUNCTION public.capture_team_activity_event();
CREATE TRIGGER team_activity_task AFTER INSERT OR UPDATE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.capture_team_activity_event();
CREATE TRIGGER team_activity_target AFTER INSERT OR UPDATE ON public.allocated_targets
FOR EACH ROW EXECUTE FUNCTION public.capture_team_activity_event();

INSERT INTO public.team_activity_events
  (event_key, event_type, source_table, source_record_id, performed_by, occurred_at, business_date)
SELECT 'call:' || log_id::text, 'call_completed', 'call_logs', log_id::text,
       user_id, timestamp, (timestamp AT TIME ZONE 'Asia/Kolkata')::date
FROM public.call_logs
WHERE user_id IS NOT NULL AND timestamp IS NOT NULL
  AND COALESCE(outcome::text, '') !~* '^\s*(\[.*\]\s*(→|->)|pipeline\s+stage)'
ON CONFLICT (event_key) DO NOTHING;

INSERT INTO public.team_activity_events
  (event_key, event_type, source_table, source_record_id, performed_by, occurred_at, business_date)
SELECT 'query:' || query_id::text, 'client_query_resolved', 'client_queries', query_id::text,
       resolved_by, resolved_at, (resolved_at AT TIME ZONE 'Asia/Kolkata')::date
FROM public.client_queries
WHERE lower(COALESCE(problem_status::text, '')) = 'resolved'
  AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL
ON CONFLICT (event_key) DO NOTHING;

INSERT INTO public.team_activity_events
  (event_key, event_type, source_table, source_record_id, performed_by, occurred_at, business_date)
SELECT 'mapping:' || request_id::text, 'mapping_completed', 'mapping_requests', request_id::text,
       mapped_by, completed_at, (completed_at AT TIME ZONE 'Asia/Kolkata')::date
FROM public.mapping_requests
WHERE lower(COALESCE(status::text, '')) IN ('completed', 'resolved')
  AND mapped_by IS NOT NULL AND completed_at IS NOT NULL
ON CONFLICT (event_key) DO NOTHING;

INSERT INTO public.team_activity_events
  (event_key, event_type, source_table, source_record_id, performed_by, occurred_at, business_date)
SELECT 'task:' || task_id::text, 'task_completed', 'tasks', task_id::text,
       assigned_to, completed_at, (completed_at AT TIME ZONE 'Asia/Kolkata')::date
FROM public.tasks
WHERE lower(COALESCE(status::text, '')) = 'completed'
  AND assigned_to IS NOT NULL AND completed_at IS NOT NULL
ON CONFLICT (event_key) DO NOTHING;

INSERT INTO public.team_activity_events
  (event_key, event_type, source_table, source_record_id, performed_by, occurred_at, business_date)
SELECT 'allocated-target:' || target_id::text, 'allocated_target_completed',
       'allocated_targets', target_id::text, assigned_to_user_id, completed_at,
       (completed_at AT TIME ZONE 'Asia/Kolkata')::date
FROM public.allocated_targets
WHERE COALESCE(is_completed, false) AND assigned_to_user_id IS NOT NULL AND completed_at IS NOT NULL
ON CONFLICT (event_key) DO NOTHING;

CREATE FUNCTION public.get_team_kpi_daily_v5(p_target_date date)
RETURNS TABLE (
  selected_date date, user_id uuid, user_name text, role_label text,
  capabilities text[], calls_count integer, client_queries_count integer,
  mappings_count integer, tasks_completed_count integer,
  total_work_count integer, last_activity_at timestamptz
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.user_id = auth.uid() AND COALESCE(u.is_active, false)
  ) OR NOT EXISTS (
    SELECT 1 FROM public.user_capabilities c
    WHERE c.user_id = auth.uid() AND c.capability_code = 'admin'
  ) THEN RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501'; END IF;

  RETURN QUERY
  WITH roles AS (
    SELECT uc.user_id,
      array_agg(DISTINCT uc.capability_code ORDER BY uc.capability_code) codes,
      string_agg(DISTINCT COALESCE(NULLIF(btrim(c.label), ''),
        initcap(replace(uc.capability_code, '_', ' '))), ' · ') labels
    FROM public.user_capabilities uc LEFT JOIN public.capabilities c ON c.code = uc.capability_code
    GROUP BY uc.user_id
  ), totals AS (
    SELECT e.performed_by,
      count(*) FILTER (WHERE e.event_type = 'call_completed')::integer calls,
      count(*) FILTER (WHERE e.event_type = 'client_query_resolved')::integer queries,
      count(*) FILTER (WHERE e.event_type = 'mapping_completed')::integer mappings,
      count(*) FILTER (WHERE e.event_type IN ('task_completed', 'allocated_target_completed'))::integer tasks,
      max(e.occurred_at) latest
    FROM public.team_activity_events e WHERE e.business_date = p_target_date GROUP BY e.performed_by
  )
  SELECT p_target_date, u.user_id, COALESCE(NULLIF(btrim(u.name), ''), 'Unnamed team member'),
    COALESCE(NULLIF(r.labels, ''), 'Team member'), COALESCE(r.codes, ARRAY[]::text[]),
    COALESCE(t.calls, 0), COALESCE(t.queries, 0), COALESCE(t.mappings, 0), COALESCE(t.tasks, 0),
    COALESCE(t.calls, 0) + COALESCE(t.queries, 0) + COALESCE(t.mappings, 0) + COALESCE(t.tasks, 0),
    t.latest
  FROM public.users u LEFT JOIN roles r ON r.user_id = u.user_id LEFT JOIN totals t ON t.performed_by = u.user_id
  WHERE COALESCE(u.is_active, false)
    AND NOT EXISTS (
      SELECT 1 FROM public.user_capabilities x
      WHERE x.user_id = u.user_id AND x.capability_code IN ('system', 'service_account')
    )
  ORDER BY (COALESCE(t.calls, 0) + COALESCE(t.queries, 0) + COALESCE(t.mappings, 0) + COALESCE(t.tasks, 0)) DESC,
    u.name, u.user_id;
END
$function$;

REVOKE ALL ON FUNCTION public.get_team_kpi_daily_v5(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_team_kpi_daily_v5(date) TO authenticated;

DO $publication$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'team_activity_events'
  ) THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.team_activity_events; END IF;
END
$publication$;

COMMIT;
