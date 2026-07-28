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

CREATE TABLE public.command_receipts (
  operation_id uuid PRIMARY KEY,
  command_name text NOT NULL,
  actor_id uuid NOT NULL REFERENCES public.users(user_id),
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.command_receipts ENABLE ROW LEVEL SECURITY;
CREATE INDEX command_receipts_actor_command_idx
  ON public.command_receipts (actor_id, command_name);

CREATE FUNCTION public.assert_active_actor()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $function$
DECLARE actor uuid := auth.uid();
BEGIN
  IF actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '28000'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u WHERE u.user_id = actor AND COALESCE(u.is_active, false)
  ) THEN RAISE EXCEPTION 'Active user required' USING ERRCODE = '42501'; END IF;
  RETURN actor;
END
$function$;

CREATE FUNCTION public.assert_command_identity(
  p_operation_id uuid, p_command_name text, p_actor uuid, p_entity_type text, p_entity_id text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $function$
DECLARE existing public.command_receipts%ROWTYPE;
BEGIN
  IF p_operation_id IS NULL THEN RAISE EXCEPTION 'Operation ID required' USING ERRCODE = '22023'; END IF;
  SELECT * INTO existing FROM public.command_receipts WHERE operation_id = p_operation_id;
  IF FOUND THEN
    IF existing.command_name <> p_command_name OR existing.actor_id <> p_actor
       OR existing.entity_type <> p_entity_type OR existing.entity_id <> p_entity_id THEN
      RAISE EXCEPTION 'Operation identity conflict' USING ERRCODE = '23505';
    END IF;
    RETURN true;
  END IF;
  RETURN false;
END
$function$;

CREATE FUNCTION public.record_command_receipt(
  p_operation_id uuid, p_command_name text, p_actor uuid, p_entity_type text, p_entity_id text
) RETURNS void LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public AS $function$
  INSERT INTO public.command_receipts(operation_id, command_name, actor_id, entity_type, entity_id)
  VALUES (p_operation_id, p_command_name, p_actor, p_entity_type, p_entity_id)
$function$;

CREATE FUNCTION public.log_call_v1(
  p_operation_id uuid, p_log_id uuid, p_lead_id uuid,
  p_client_username text, p_client_name text, p_occurred_at timestamptz,
  p_outcome text, p_notes text DEFAULT NULL, p_next_followup_date timestamptz DEFAULT NULL
) RETURNS SETOF public.call_logs LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $function$
DECLARE actor uuid := public.assert_active_actor();
BEGIN
  IF p_log_id IS NULL OR p_occurred_at IS NULL OR p_occurred_at > now() + interval '5 minutes'
     OR NULLIF(btrim(p_outcome), '') IS NULL THEN
    RAISE EXCEPTION 'Invalid call payload' USING ERRCODE = '22023';
  END IF;
  IF p_lead_id IS NULL AND (
    NULLIF(btrim(p_client_username), '') IS NULL OR NULLIF(btrim(p_client_name), '') IS NULL
  ) THEN RAISE EXCEPTION 'Lead or external client identity required' USING ERRCODE = '22023'; END IF;
  IF p_lead_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.leads l WHERE l.lead_id = p_lead_id AND public.has_segment_access(l.segment_type)
  ) THEN RAISE EXCEPTION 'Call lead is not accessible' USING ERRCODE = '42501'; END IF;
  IF public.assert_command_identity(p_operation_id, 'log_call_v1', actor, 'call', p_log_id::text) THEN
    RETURN QUERY SELECT * FROM public.call_logs WHERE log_id = p_log_id AND user_id = actor;
    IF NOT FOUND THEN RAISE EXCEPTION 'Receipt source record missing' USING ERRCODE = 'P0002'; END IF;
    RETURN;
  END IF;
  INSERT INTO public.call_logs(
    log_id, user_id, lead_id, client_username, client_name, timestamp, outcome, notes, next_followup_date
  ) VALUES (
    p_log_id, actor, p_lead_id, NULLIF(btrim(p_client_username), ''),
    NULLIF(btrim(p_client_name), ''), p_occurred_at, p_outcome, p_notes, p_next_followup_date
  );
  PERFORM public.record_command_receipt(p_operation_id, 'log_call_v1', actor, 'call', p_log_id::text);
  RETURN QUERY SELECT * FROM public.call_logs WHERE log_id = p_log_id;
END
$function$;

CREATE FUNCTION public.resolve_client_query_v1(
  p_operation_id uuid, p_query_id uuid, p_occurred_at timestamptz, p_resolution_notes text DEFAULT NULL
) RETURNS SETOF public.client_queries LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $function$
DECLARE actor uuid := public.assert_active_actor();
BEGIN
  IF p_query_id IS NULL OR p_occurred_at IS NULL OR p_occurred_at > now() + interval '5 minutes'
     THEN RAISE EXCEPTION 'Invalid query resolution payload' USING ERRCODE = '22023'; END IF;
  IF NOT public.has_capability('ret_support') AND NOT public.has_capability('dist_support')
     AND NOT public.has_capability('admin') THEN
    RAISE EXCEPTION 'Support capability required' USING ERRCODE = '42501';
  END IF;
  IF public.assert_command_identity(p_operation_id, 'resolve_client_query_v1', actor, 'client_query', p_query_id::text) THEN
    RETURN QUERY SELECT * FROM public.client_queries WHERE query_id = p_query_id AND resolved_by = actor;
    IF NOT FOUND THEN RAISE EXCEPTION 'Receipt source record missing' USING ERRCODE = 'P0002'; END IF;
    RETURN;
  END IF;
  UPDATE public.client_queries SET problem_status = 'Resolved', resolved_by = actor,
    resolved_at = p_occurred_at, resolution_notes = COALESCE(p_resolution_notes, resolution_notes)
  WHERE query_id = p_query_id AND lower(COALESCE(problem_status::text, '')) <> 'resolved';
  IF NOT FOUND THEN RAISE EXCEPTION 'Query missing or already resolved' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.record_command_receipt(p_operation_id, 'resolve_client_query_v1', actor, 'client_query', p_query_id::text);
  RETURN QUERY SELECT * FROM public.client_queries WHERE query_id = p_query_id;
END
$function$;

CREATE FUNCTION public.complete_mapping_v1(
  p_operation_id uuid, p_request_id uuid, p_occurred_at timestamptz
) RETURNS SETOF public.mapping_requests LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $function$
DECLARE actor uuid := public.assert_active_actor();
BEGIN
  IF p_request_id IS NULL OR p_occurred_at IS NULL OR p_occurred_at > now() + interval '5 minutes'
     THEN RAISE EXCEPTION 'Invalid mapping completion payload' USING ERRCODE = '22023'; END IF;
  IF NOT public.has_capability('ret_support') AND NOT public.has_capability('dist_support')
     AND NOT public.has_capability('admin') THEN
    RAISE EXCEPTION 'Mapping capability required' USING ERRCODE = '42501';
  END IF;
  IF public.assert_command_identity(p_operation_id, 'complete_mapping_v1', actor, 'mapping_request', p_request_id::text) THEN
    RETURN QUERY SELECT * FROM public.mapping_requests WHERE request_id = p_request_id AND mapped_by = actor;
    IF NOT FOUND THEN RAISE EXCEPTION 'Receipt source record missing' USING ERRCODE = 'P0002'; END IF;
    RETURN;
  END IF;
  UPDATE public.mapping_requests SET status = 'Completed', mapped_by = actor, completed_at = p_occurred_at
  WHERE request_id = p_request_id AND lower(COALESCE(status::text, '')) <> 'completed';
  IF NOT FOUND THEN RAISE EXCEPTION 'Mapping missing or already completed' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.record_command_receipt(p_operation_id, 'complete_mapping_v1', actor, 'mapping_request', p_request_id::text);
  RETURN QUERY SELECT * FROM public.mapping_requests WHERE request_id = p_request_id;
END
$function$;

CREATE FUNCTION public.complete_task_v1(
  p_operation_id uuid, p_task_id uuid, p_occurred_at timestamptz
) RETURNS SETOF public.tasks LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $function$
DECLARE actor uuid := public.assert_active_actor(); old_status text;
BEGIN
  IF p_task_id IS NULL OR p_occurred_at IS NULL OR p_occurred_at > now() + interval '5 minutes'
     THEN RAISE EXCEPTION 'Invalid task completion payload' USING ERRCODE = '22023'; END IF;
  IF public.assert_command_identity(p_operation_id, 'complete_task_v1', actor, 'task', p_task_id::text) THEN
    RETURN QUERY SELECT * FROM public.tasks WHERE task_id = p_task_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Receipt source record missing' USING ERRCODE = 'P0002'; END IF;
    RETURN;
  END IF;
  SELECT status::text INTO old_status FROM public.tasks
  WHERE task_id = p_task_id AND (assigned_to = actor OR public.has_capability('admin')) FOR UPDATE;
  IF NOT FOUND OR lower(COALESCE(old_status, '')) = 'completed'
     THEN RAISE EXCEPTION 'Task missing, unauthorized, or already completed' USING ERRCODE = 'P0002'; END IF;
  UPDATE public.tasks SET status = 'Completed', completed_at = p_occurred_at WHERE task_id = p_task_id;
  INSERT INTO public.task_status_history(id, task_id, changed_by, old_status, new_status, changed_at)
  VALUES (gen_random_uuid(), p_task_id, actor, old_status, 'Completed', p_occurred_at);
  PERFORM public.record_command_receipt(p_operation_id, 'complete_task_v1', actor, 'task', p_task_id::text);
  RETURN QUERY SELECT * FROM public.tasks WHERE task_id = p_task_id;
END
$function$;

CREATE FUNCTION public.complete_allocated_target_v1(
  p_operation_id uuid, p_target_id uuid, p_occurred_at timestamptz
) RETURNS SETOF public.allocated_targets LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $function$
DECLARE actor uuid := public.assert_active_actor();
BEGIN
  IF p_target_id IS NULL OR p_occurred_at IS NULL OR p_occurred_at > now() + interval '5 minutes'
     THEN RAISE EXCEPTION 'Invalid target completion payload' USING ERRCODE = '22023'; END IF;
  IF public.assert_command_identity(p_operation_id, 'complete_allocated_target_v1', actor, 'allocated_target', p_target_id::text) THEN
    RETURN QUERY SELECT * FROM public.allocated_targets WHERE target_id = p_target_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Receipt source record missing' USING ERRCODE = 'P0002'; END IF;
    RETURN;
  END IF;
  UPDATE public.allocated_targets SET is_completed = true, completed_at = p_occurred_at
  WHERE target_id = p_target_id AND NOT is_completed
    AND (assigned_to_user_id = actor OR public.has_capability('admin'));
  IF NOT FOUND THEN RAISE EXCEPTION 'Target missing, unauthorized, or already completed' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.record_command_receipt(p_operation_id, 'complete_allocated_target_v1', actor, 'allocated_target', p_target_id::text);
  RETURN QUERY SELECT * FROM public.allocated_targets WHERE target_id = p_target_id;
END
$function$;

CREATE FUNCTION public.create_field_visit_v1(
  p_operation_id uuid, p_visit_id uuid, p_lead_id text, p_visit_date date,
  p_check_in_time timestamptz, p_lat double precision, p_lng double precision,
  p_accuracy numeric, p_location_captured_at timestamptz, p_location_mode text,
  p_location_quality text, p_selfie_captured_at timestamptz, p_selfie_method text,
  p_selfie_path text, p_outcome text, p_notes text, p_attendance_id uuid,
  p_person_met text, p_segment text, p_follow_up_date date DEFAULT NULL
) RETURNS SETOF public.field_visits LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $function$
DECLARE actor uuid := public.assert_active_actor(); expected_path text;
BEGIN
  expected_path := actor::text || '/' || p_visit_date::text || '/' || p_visit_id::text || '.jpg';
  IF p_visit_id IS NULL OR p_check_in_time IS NULL OR p_check_in_time > now() + interval '5 minutes'
     OR p_visit_date <> (p_check_in_time AT TIME ZONE 'Asia/Kolkata')::date
     OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180
     OR p_accuracy IS NULL OR p_accuracy <= 0 OR p_location_captured_at IS NULL
     OR p_selfie_captured_at IS NULL OR p_selfie_path <> expected_path
     OR p_outcome NOT IN ('registered','installed','interested','follow_up','not_interested')
     OR p_segment NOT IN ('Retailer','Distributor')
     OR (p_outcome = 'follow_up' AND (p_follow_up_date IS NULL OR p_follow_up_date < p_visit_date))
     OR (p_outcome IN ('follow_up','not_interested') AND NULLIF(btrim(p_notes), '') IS NULL)
     THEN RAISE EXCEPTION 'Invalid field visit payload' USING ERRCODE = '22023'; END IF;
  IF (p_segment = 'Retailer' AND NOT public.has_capability('field_ret'))
     OR (p_segment = 'Distributor' AND NOT public.has_capability('field_dist')) THEN
    RAISE EXCEPTION 'Field segment capability required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.attendance a
    WHERE a.attendance_id = p_attendance_id AND a.user_id = actor AND a.date = p_visit_date
  ) THEN RAISE EXCEPTION 'Matching attendance required' USING ERRCODE = '23503'; END IF;
  IF public.assert_command_identity(p_operation_id, 'create_field_visit_v1', actor, 'field_visit', p_visit_id::text) THEN
    RETURN QUERY SELECT * FROM public.field_visits WHERE visit_id = p_visit_id AND user_id = actor;
    IF NOT FOUND THEN RAISE EXCEPTION 'Receipt source record missing' USING ERRCODE = 'P0002'; END IF;
    RETURN;
  END IF;
  INSERT INTO public.field_visits(
    visit_id, lead_id, user_id, visit_date, check_in_time, check_in_lat, check_in_lng,
    location_accuracy_m, location_captured_at, location_acquisition_mode, location_quality,
    selfie_captured_at, selfie_capture_method, selfie_storage_path, visit_outcome, visit_notes,
    attendance_id, person_met, segment_type, follow_up_date, sync_status
  ) VALUES (
    p_visit_id, p_lead_id, actor, p_visit_date, p_check_in_time, p_lat, p_lng,
    p_accuracy, p_location_captured_at, p_location_mode, p_location_quality,
    p_selfie_captured_at, p_selfie_method, p_selfie_path, p_outcome, p_notes,
    p_attendance_id, p_person_met, p_segment, p_follow_up_date, 'synced'
  );
  PERFORM public.record_command_receipt(p_operation_id, 'create_field_visit_v1', actor, 'field_visit', p_visit_id::text);
  RETURN QUERY SELECT * FROM public.field_visits WHERE visit_id = p_visit_id;
END
$function$;

REVOKE ALL ON FUNCTION public.assert_active_actor() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.assert_command_identity(uuid,text,uuid,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_command_receipt(uuid,text,uuid,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.log_call_v1(uuid,uuid,uuid,text,text,timestamptz,text,text,timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resolve_client_query_v1(uuid,uuid,timestamptz,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_mapping_v1(uuid,uuid,timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_task_v1(uuid,uuid,timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_allocated_target_v1(uuid,uuid,timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_field_visit_v1(uuid,uuid,text,date,timestamptz,double precision,double precision,numeric,timestamptz,text,text,timestamptz,text,text,text,text,uuid,text,text,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_call_v1(uuid,uuid,uuid,text,text,timestamptz,text,text,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_client_query_v1(uuid,uuid,timestamptz,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_mapping_v1(uuid,uuid,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_task_v1(uuid,uuid,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_allocated_target_v1(uuid,uuid,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_field_visit_v1(uuid,uuid,text,date,timestamptz,double precision,double precision,numeric,timestamptz,text,text,timestamptz,text,text,text,text,uuid,text,text,date) TO authenticated;

CREATE FUNCTION public.get_admin_visit_report_v1(
  p_from_date date, p_to_date date, p_representative uuid DEFAULT NULL,
  p_segment text DEFAULT NULL, p_outcomes text[] DEFAULT NULL, p_search text DEFAULT NULL,
  p_page integer DEFAULT 1, p_page_size integer DEFAULT 50, p_sort_desc boolean DEFAULT true
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $function$
DECLARE actor uuid := public.assert_active_actor(); result jsonb;
BEGIN
  IF NOT public.has_capability('admin') THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  IF p_from_date IS NULL OR p_to_date IS NULL OR p_from_date > p_to_date
     OR p_page < 1 OR p_page_size NOT BETWEEN 1 AND 200
     OR (p_segment IS NOT NULL AND p_segment NOT IN ('Retailer','Distributor'))
     THEN RAISE EXCEPTION 'Invalid visit report filters' USING ERRCODE = '22023'; END IF;
  WITH filtered AS (
    SELECT v.*, u.name representative_name, u.email representative_email,
      l.business_name, l.contact_person, l.phone
    FROM public.field_visits v
    JOIN public.users u ON u.user_id = v.user_id
    LEFT JOIN public.leads l ON l.lead_id::text = v.lead_id
    WHERE v.visit_date BETWEEN p_from_date AND p_to_date
      AND (p_representative IS NULL OR v.user_id = p_representative)
      AND (p_segment IS NULL OR v.segment_type = p_segment)
      AND (p_outcomes IS NULL OR cardinality(p_outcomes) = 0 OR v.visit_outcome = ANY(p_outcomes))
      AND (
        NULLIF(btrim(p_search), '') IS NULL
        OR u.name ILIKE '%' || btrim(p_search) || '%'
        OR COALESCE(l.business_name, '') ILIKE '%' || btrim(p_search) || '%'
        OR COALESCE(v.person_met, '') ILIKE '%' || btrim(p_search) || '%'
        OR v.lead_id ILIKE '%' || btrim(p_search) || '%'
      )
  ), totals AS (
    SELECT count(*) total,
      count(*) FILTER (WHERE segment_type = 'Retailer') retailer,
      count(*) FILTER (WHERE segment_type = 'Distributor') distributor
    FROM filtered
  ), page_rows AS (
    SELECT * FROM filtered
    ORDER BY
      CASE WHEN p_sort_desc THEN check_in_time END DESC,
      CASE WHEN NOT p_sort_desc THEN check_in_time END ASC,
      visit_id
    OFFSET (p_page - 1) * p_page_size LIMIT p_page_size
  )
  SELECT jsonb_build_object(
    'rows', COALESCE((SELECT jsonb_agg(to_jsonb(page_rows)) FROM page_rows), '[]'::jsonb),
    'totals', (SELECT jsonb_build_object('total', total, 'retailer', retailer, 'distributor', distributor) FROM totals),
    'filters', jsonb_build_object('from', p_from_date, 'to', p_to_date, 'representative', p_representative,
      'segment', p_segment, 'outcomes', p_outcomes, 'search', p_search, 'page', p_page, 'page_size', p_page_size),
    'generated_at', now()
  ) INTO result;
  RETURN result;
END
$function$;

CREATE FUNCTION public.get_admin_data_health_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public AS $function$
BEGIN
  PERFORM public.assert_active_actor();
  IF NOT public.has_capability('admin') THEN
    RAISE EXCEPTION 'Administrator access required' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'latest_call_at', (SELECT max(timestamp) FROM public.call_logs),
    'latest_query_at', (SELECT max(resolved_at) FROM public.client_queries WHERE lower(COALESCE(problem_status::text, '')) = 'resolved'),
    'latest_mapping_at', (SELECT max(completed_at) FROM public.mapping_requests WHERE lower(COALESCE(status::text, '')) = 'completed'),
    'latest_task_at', (SELECT max(completed_at) FROM public.tasks WHERE lower(COALESCE(status::text, '')) = 'completed'),
    'latest_target_at', (SELECT max(completed_at) FROM public.allocated_targets WHERE is_completed),
    'latest_visit_at', (SELECT max(check_in_time) FROM public.field_visits),
    'latest_kpi_event_at', (SELECT max(occurred_at) FROM public.team_activity_events),
    'receipt_count', (SELECT count(*) FROM public.command_receipts),
    'source_event_difference', jsonb_build_object(
      'calls', (SELECT count(*) FROM public.call_logs WHERE user_id IS NOT NULL AND timestamp IS NOT NULL
        AND COALESCE(outcome::text, '') !~* '^\s*(\[.*\]\s*(→|->)|pipeline\s+stage)')
        - (SELECT count(*) FROM public.team_activity_events WHERE event_type = 'call_completed'),
      'queries', (SELECT count(*) FROM public.client_queries WHERE lower(COALESCE(problem_status::text, '')) = 'resolved'
        AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)
        - (SELECT count(*) FROM public.team_activity_events WHERE event_type = 'client_query_resolved'),
      'mappings', (SELECT count(*) FROM public.mapping_requests WHERE lower(COALESCE(status::text, '')) = 'completed'
        AND mapped_by IS NOT NULL AND completed_at IS NOT NULL)
        - (SELECT count(*) FROM public.team_activity_events WHERE event_type = 'mapping_completed'),
      'tasks', (SELECT count(*) FROM public.tasks WHERE lower(COALESCE(status::text, '')) = 'completed'
        AND assigned_to IS NOT NULL AND completed_at IS NOT NULL)
        - (SELECT count(*) FROM public.team_activity_events WHERE event_type = 'task_completed'),
      'targets', (SELECT count(*) FROM public.allocated_targets WHERE is_completed
        AND assigned_to_user_id IS NOT NULL AND completed_at IS NOT NULL)
        - (SELECT count(*) FROM public.team_activity_events WHERE event_type = 'allocated_target_completed')
    ),
    'generated_at', now()
  );
END
$function$;

REVOKE ALL ON FUNCTION public.get_admin_visit_report_v1(date,date,uuid,text,text[],text,integer,integer,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_admin_data_health_v1() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_admin_visit_report_v1(date,date,uuid,text,text[],text,integer,integer,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_data_health_v1() TO authenticated;

COMMIT;
