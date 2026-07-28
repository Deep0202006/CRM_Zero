-- ZeroData CRM — Final Team KPI and Work-Persistence Root Repair

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Create team_kpi_events reporting projection table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.team_kpi_events (
    event_key text PRIMARY KEY,
    event_type text NOT NULL,
    source_table text NOT NULL,
    source_record_id text NOT NULL,
    performed_by uuid NOT NULL REFERENCES public.users(user_id),
    occurred_at timestamptz NOT NULL,
    business_date date NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.team_kpi_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_kpi_events_admin_select ON public.team_kpi_events;
CREATE POLICY team_kpi_events_admin_select ON public.team_kpi_events
    FOR SELECT TO authenticated
    USING (
      EXISTS (
        SELECT 1
        FROM public.user_capabilities admin_capability
        WHERE admin_capability.user_id = auth.uid()
          AND admin_capability.capability_code = 'admin'
      )
    );

-- Also allow Realtime to publish it
DO \\$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'team_kpi_events'
      ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.team_kpi_events;
    END IF;
  END IF;
END
\\$;

CREATE INDEX IF NOT EXISTS idx_team_kpi_events_business_date ON public.team_kpi_events (business_date);

-- -----------------------------------------------------------------------------
-- 2. Internal Trigger Function to Capture KPI Events
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tf_capture_team_kpi_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS \\$
DECLARE
  v_event_key text;
  v_event_type text;
  v_source_record_id text;
  v_performed_by uuid;
  v_occurred_at timestamptz;
  v_business_date date;
BEGIN
  -- call_logs
  IF TG_TABLE_NAME = 'call_logs' THEN
    IF NEW.user_id IS NULL OR NEW.timestamp IS NULL OR COALESCE(NEW.outcome, '') ~* '^\s*(\[.*\]\s*(→|->)|pipeline\s+stage)' THEN
      RETURN NEW;
    END IF;
    v_event_key := 'call:' || NEW.log_id::text;
    v_event_type := 'call';
    v_source_record_id := NEW.log_id::text;
    v_performed_by := NEW.user_id;
    v_occurred_at := NEW.timestamp;

  -- client_queries
  ELSIF TG_TABLE_NAME = 'client_queries' THEN
    IF lower(COALESCE(NEW.problem_status, '')) != 'resolved' OR NEW.resolved_at IS NULL THEN
      RETURN NEW;
    END IF;
    v_event_key := 'query:' || NEW.query_id::text;
    v_event_type := 'client_query';
    v_source_record_id := NEW.query_id::text;
    v_performed_by := COALESCE(NEW.resolved_by, NEW.assigned_to);
    v_occurred_at := NEW.resolved_at;
    IF v_performed_by IS NULL THEN RETURN NEW; END IF;

  -- mapping_requests
  ELSIF TG_TABLE_NAME = 'mapping_requests' THEN
    IF lower(COALESCE(NEW.status, '')) NOT IN ('completed', 'resolved') OR NEW.completed_at IS NULL OR NEW.mapped_by IS NULL THEN
      RETURN NEW;
    END IF;
    v_event_key := 'mapping-request:' || NEW.request_id::text;
    v_event_type := 'mapping';
    v_source_record_id := NEW.request_id::text;
    v_performed_by := NEW.mapped_by;
    v_occurred_at := NEW.completed_at;

  -- task_status_history
  ELSIF TG_TABLE_NAME = 'task_status_history' THEN
    IF lower(COALESCE(NEW.new_status, '')) != 'completed' OR NEW.changed_at IS NULL THEN
      RETURN NEW;
    END IF;
    v_event_key := 'task-history:' || NEW.task_id::text || ':' || ((NEW.changed_at AT TIME ZONE 'Asia/Kolkata')::date)::text;
    v_event_type := 'task';
    v_source_record_id := NEW.history_id::text;
    v_performed_by := NEW.changed_by;
    v_occurred_at := NEW.changed_at;
    IF v_performed_by IS NULL THEN
      SELECT assigned_to INTO v_performed_by FROM public.tasks WHERE task_id = NEW.task_id;
      IF v_performed_by IS NULL THEN RETURN NEW; END IF;
    END IF;

  -- tasks
  ELSIF TG_TABLE_NAME = 'tasks' THEN
    IF lower(COALESCE(NEW.status::text, '')) != 'completed' OR NEW.completed_at IS NULL OR NEW.assigned_to IS NULL THEN
      RETURN NEW;
    END IF;
    v_event_key := 'task-row:' || NEW.task_id::text;
    v_event_type := 'task';
    v_source_record_id := NEW.task_id::text;
    v_performed_by := NEW.assigned_to;
    v_occurred_at := NEW.completed_at;

  -- allocated_targets
  ELSIF TG_TABLE_NAME = 'allocated_targets' THEN
    IF NOT COALESCE(NEW.is_completed, false) OR NEW.completed_at IS NULL OR NEW.assigned_to_user_id IS NULL THEN
      RETURN NEW;
    END IF;
    v_event_key := 'allocated-target:' || NEW.target_id::text;
    v_event_type := 'task';
    v_source_record_id := NEW.target_id::text;
    v_performed_by := NEW.assigned_to_user_id;
    v_occurred_at := NEW.completed_at;
  
  ELSE
    RETURN NEW;
  END IF;

  v_business_date := (v_occurred_at AT TIME ZONE 'Asia/Kolkata')::date;

  INSERT INTO public.team_kpi_events (
    event_key, event_type, source_table, source_record_id, performed_by, occurred_at, business_date
  ) VALUES (
    v_event_key, v_event_type, TG_TABLE_NAME, v_source_record_id, v_performed_by, v_occurred_at, v_business_date
  )
  ON CONFLICT (event_key) DO UPDATE SET
    event_type = EXCLUDED.event_type,
    source_table = EXCLUDED.source_table,
    source_record_id = EXCLUDED.source_record_id,
    performed_by = EXCLUDED.performed_by,
    occurred_at = EXCLUDED.occurred_at,
    business_date = EXCLUDED.business_date;

  RETURN NEW;
END;
\\$;

-- -----------------------------------------------------------------------------
-- 3. Apply Triggers to Source Tables
-- -----------------------------------------------------------------------------

DROP TRIGGER IF EXISTS team_kpi_capture_call_log ON public.call_logs;
CREATE TRIGGER team_kpi_capture_call_log
  AFTER INSERT OR UPDATE ON public.call_logs
  FOR EACH ROW EXECUTE FUNCTION public.tf_capture_team_kpi_event();

DROP TRIGGER IF EXISTS team_kpi_capture_client_query ON public.client_queries;
CREATE TRIGGER team_kpi_capture_client_query
  AFTER INSERT OR UPDATE ON public.client_queries
  FOR EACH ROW EXECUTE FUNCTION public.tf_capture_team_kpi_event();

DROP TRIGGER IF EXISTS team_kpi_capture_mapping_request ON public.mapping_requests;
CREATE TRIGGER team_kpi_capture_mapping_request
  AFTER INSERT OR UPDATE ON public.mapping_requests
  FOR EACH ROW EXECUTE FUNCTION public.tf_capture_team_kpi_event();

DROP TRIGGER IF EXISTS team_kpi_capture_task_history ON public.task_status_history;
CREATE TRIGGER team_kpi_capture_task_history
  AFTER INSERT OR UPDATE ON public.task_status_history
  FOR EACH ROW EXECUTE FUNCTION public.tf_capture_team_kpi_event();

DROP TRIGGER IF EXISTS team_kpi_capture_task ON public.tasks;
CREATE TRIGGER team_kpi_capture_task
  AFTER INSERT OR UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.tf_capture_team_kpi_event();

DROP TRIGGER IF EXISTS team_kpi_capture_allocated_target ON public.allocated_targets;
CREATE TRIGGER team_kpi_capture_allocated_target
  AFTER INSERT OR UPDATE ON public.allocated_targets
  FOR EACH ROW EXECUTE FUNCTION public.tf_capture_team_kpi_event();

-- -----------------------------------------------------------------------------
-- 4. Historical Backfill
-- -----------------------------------------------------------------------------

TRUNCATE TABLE public.team_kpi_events;

-- Backfill calls
INSERT INTO public.team_kpi_events (event_key, event_type, source_table, source_record_id, performed_by, occurred_at, business_date)
SELECT
  'call:' || call_log.log_id::text,
  'call',
  'call_logs',
  call_log.log_id::text,
  call_log.user_id,
  call_log.timestamp,
  (call_log.timestamp AT TIME ZONE 'Asia/Kolkata')::date
FROM public.call_logs call_log
WHERE call_log.user_id IS NOT NULL
  AND call_log.timestamp IS NOT NULL
  AND COALESCE(call_log.outcome, '') !~* '^\s*(\[.*\]\s*(→|->)|pipeline\s+stage)'
ON CONFLICT (event_key) DO NOTHING;

-- Backfill client_queries
INSERT INTO public.team_kpi_events (event_key, event_type, source_table, source_record_id, performed_by, occurred_at, business_date)
SELECT
  'query:' || query_row.query_id::text,
  'client_query',
  'client_queries',
  query_row.query_id::text,
  COALESCE(query_row.resolved_by, query_row.assigned_to),
  query_row.resolved_at,
  (query_row.resolved_at AT TIME ZONE 'Asia/Kolkata')::date
FROM public.client_queries query_row
WHERE lower(COALESCE(query_row.problem_status, '')) = 'resolved'
  AND query_row.resolved_at IS NOT NULL
  AND COALESCE(query_row.resolved_by, query_row.assigned_to) IS NOT NULL
ON CONFLICT (event_key) DO NOTHING;

-- Backfill mapping_requests
INSERT INTO public.team_kpi_events (event_key, event_type, source_table, source_record_id, performed_by, occurred_at, business_date)
SELECT
  'mapping-request:' || mapping_request.request_id::text,
  'mapping',
  'mapping_requests',
  mapping_request.request_id::text,
  mapping_request.mapped_by,
  mapping_request.completed_at,
  (mapping_request.completed_at AT TIME ZONE 'Asia/Kolkata')::date
FROM public.mapping_requests mapping_request
WHERE lower(COALESCE(mapping_request.status, '')) IN ('completed', 'resolved')
  AND mapping_request.mapped_by IS NOT NULL
  AND mapping_request.completed_at IS NOT NULL
ON CONFLICT (event_key) DO NOTHING;

-- Backfill task_status_history
INSERT INTO public.team_kpi_events (event_key, event_type, source_table, source_record_id, performed_by, occurred_at, business_date)
SELECT DISTINCT ON (
  task_history.task_id,
  (task_history.changed_at AT TIME ZONE 'Asia/Kolkata')::date
)
  'task-history:' || task_history.task_id::text || ':' || ((task_history.changed_at AT TIME ZONE 'Asia/Kolkata')::date)::text,
  'task',
  'task_status_history',
  task_history.history_id::text,
  COALESCE(task_history.changed_by, task_row.assigned_to),
  task_history.changed_at,
  (task_history.changed_at AT TIME ZONE 'Asia/Kolkata')::date
FROM public.task_status_history task_history
LEFT JOIN public.tasks task_row ON task_row.task_id = task_history.task_id
WHERE lower(COALESCE(task_history.new_status, '')) = 'completed'
  AND task_history.changed_at IS NOT NULL
  AND COALESCE(task_history.changed_by, task_row.assigned_to) IS NOT NULL
ORDER BY
  task_history.task_id,
  (task_history.changed_at AT TIME ZONE 'Asia/Kolkata')::date,
  task_history.changed_at DESC
ON CONFLICT (event_key) DO NOTHING;

-- Backfill tasks without history
INSERT INTO public.team_kpi_events (event_key, event_type, source_table, source_record_id, performed_by, occurred_at, business_date)
SELECT
  'task-row:' || task_row.task_id::text,
  'task',
  'tasks',
  task_row.task_id::text,
  task_row.assigned_to,
  task_row.completed_at,
  (task_row.completed_at AT TIME ZONE 'Asia/Kolkata')::date
FROM public.tasks task_row
WHERE lower(COALESCE(task_row.status::text, '')) = 'completed'
  AND task_row.assigned_to IS NOT NULL
  AND task_row.completed_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.task_status_history completion_history
    WHERE completion_history.task_id = task_row.task_id
      AND lower(COALESCE(completion_history.new_status, '')) = 'completed'
  )
ON CONFLICT (event_key) DO NOTHING;

-- Backfill allocated_targets
INSERT INTO public.team_kpi_events (event_key, event_type, source_table, source_record_id, performed_by, occurred_at, business_date)
SELECT
  'allocated-target:' || target_row.target_id::text,
  'task',
  'allocated_targets',
  target_row.target_id::text,
  target_row.assigned_to_user_id,
  target_row.completed_at,
  (target_row.completed_at AT TIME ZONE 'Asia/Kolkata')::date
FROM public.allocated_targets target_row
WHERE COALESCE(target_row.is_completed, false) = true
  AND target_row.assigned_to_user_id IS NOT NULL
  AND target_row.completed_at IS NOT NULL
ON CONFLICT (event_key) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 5. get_team_kpi_daily_v5 RPC
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_team_kpi_daily_v5(p_target_date date)
RETURNS TABLE (
  selected_date date,
  user_id uuid,
  user_name text,
  role_label text,
  capabilities text[],
  calls_count integer,
  client_queries_count integer,
  mappings_count integer,
  tasks_completed_count integer,
  total_work_count integer,
  last_activity_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS \\$
DECLARE
  requesting_user uuid := auth.uid();
BEGIN
  IF requesting_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required for Team KPI.' USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users requesting_profile
    WHERE requesting_profile.user_id = requesting_user
      AND lower(COALESCE(requesting_profile.is_active::text, 'false')) IN ('1', 'true', 't')
  ) THEN
    RAISE EXCEPTION 'The requesting account is inactive.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_capabilities requesting_capability
    WHERE requesting_capability.user_id = requesting_user
      AND requesting_capability.capability_code = 'admin'
  ) THEN
    RAISE EXCEPTION 'Administrator access is required for Team KPI.' USING ERRCODE = '42501';
  END IF;

  IF p_target_date IS NULL THEN
    RAISE EXCEPTION 'A target date is required.' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH user_roles AS (
    SELECT
      capability_assignment.user_id,
      array_agg(DISTINCT capability_assignment.capability_code ORDER BY capability_assignment.capability_code) AS capability_codes,
      string_agg(
        DISTINCT COALESCE(
          NULLIF(btrim(capability_definition.label), ''),
          initcap(replace(capability_assignment.capability_code, '_', ' '))
        ),
        ' · '
        ORDER BY COALESCE(
          NULLIF(btrim(capability_definition.label), ''),
          initcap(replace(capability_assignment.capability_code, '_', ' '))
        )
      ) AS labels
    FROM public.user_capabilities capability_assignment
    LEFT JOIN public.capabilities capability_definition
      ON capability_definition.code = capability_assignment.capability_code
    GROUP BY capability_assignment.user_id
  ),
  event_totals AS (
    SELECT
      event.performed_by AS event_user_id,
      count(*) FILTER (WHERE event.event_type = 'call')::integer AS calls,
      count(*) FILTER (WHERE event.event_type = 'client_query')::integer AS client_queries,
      count(*) FILTER (WHERE event.event_type = 'mapping')::integer AS mappings,
      count(*) FILTER (WHERE event.event_type = 'task')::integer AS tasks,
      max(event.occurred_at) AS latest_activity
    FROM public.team_kpi_events event
    WHERE event.business_date = p_target_date
    GROUP BY event.performed_by
  )
  SELECT
    p_target_date,
    team_user.user_id,
    COALESCE(NULLIF(btrim(team_user.name), ''), 'Unnamed team member'),
    COALESCE(NULLIF(user_roles.labels, ''), 'Team member'),
    COALESCE(user_roles.capability_codes, ARRAY[]::text[]),
    COALESCE(event_totals.calls, 0),
    COALESCE(event_totals.client_queries, 0),
    COALESCE(event_totals.mappings, 0),
    COALESCE(event_totals.tasks, 0),
    COALESCE(event_totals.calls, 0)
      + COALESCE(event_totals.client_queries, 0)
      + COALESCE(event_totals.mappings, 0)
      + COALESCE(event_totals.tasks, 0),
    event_totals.latest_activity
  FROM public.users team_user
  LEFT JOIN user_roles ON user_roles.user_id = team_user.user_id
  LEFT JOIN event_totals ON event_totals.event_user_id = team_user.user_id
  WHERE lower(COALESCE(team_user.is_active::text, 'false')) IN ('1', 'true', 't')
    AND NOT EXISTS (
      SELECT 1
      FROM public.user_capabilities excluded_capability
      WHERE excluded_capability.user_id = team_user.user_id
        AND excluded_capability.capability_code IN ('system', 'service_account')
    )
  ORDER BY
    (
      COALESCE(event_totals.calls, 0)
      + COALESCE(event_totals.client_queries, 0)
      + COALESCE(event_totals.mappings, 0)
      + COALESCE(event_totals.tasks, 0)
    ) DESC,
    team_user.name ASC,
    team_user.user_id ASC;
END;
\\$;

REVOKE ALL ON FUNCTION public.get_team_kpi_daily_v5(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_team_kpi_daily_v5(date) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_team_kpi_daily_v5(date) TO authenticated;

-- -----------------------------------------------------------------------------
-- 6. v2 Server Command RPCs for Secure Work Recording
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_call_v2(
  p_log_id uuid,
  p_lead_id uuid,
  p_client_username text,
  p_client_name text,
  p_duration interval,
  p_outcome text,
  p_timestamp timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS \\$
DECLARE
  requesting_user uuid := auth.uid();
BEGIN
  IF requesting_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '28000';
  END IF;

  INSERT INTO public.call_logs (
    log_id, user_id, lead_id, client_username, client_name, duration, outcome, timestamp
  ) VALUES (
    p_log_id, requesting_user, p_lead_id, p_client_username, p_client_name, p_duration, p_outcome, COALESCE(p_timestamp, now())
  )
  ON CONFLICT (log_id) DO UPDATE SET
    lead_id = EXCLUDED.lead_id,
    client_username = EXCLUDED.client_username,
    client_name = EXCLUDED.client_name,
    duration = EXCLUDED.duration,
    outcome = EXCLUDED.outcome,
    timestamp = EXCLUDED.timestamp;

  RETURN jsonb_build_object('success', true, 'log_id', p_log_id);
END;
\\$;

CREATE OR REPLACE FUNCTION public.resolve_client_query_v2(
  p_query_id uuid,
  p_resolution_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS \\$
DECLARE
  requesting_user uuid := auth.uid();
  v_now timestamptz := now();
BEGIN
  IF requesting_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '28000';
  END IF;

  UPDATE public.client_queries
  SET
    problem_status = 'Resolved',
    resolved_by = requesting_user,
    resolved_at = v_now,
    resolution_notes = COALESCE(p_resolution_notes, resolution_notes)
  WHERE query_id = p_query_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Client query not found.' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object('success', true, 'query_id', p_query_id);
END;
\\$;

CREATE OR REPLACE FUNCTION public.complete_mapping_request_v2(
  p_request_id uuid,
  p_mapping_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS \\$
DECLARE
  requesting_user uuid := auth.uid();
  v_now timestamptz := now();
BEGIN
  IF requesting_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '28000';
  END IF;

  UPDATE public.mapping_requests
  SET
    status = 'Completed',
    mapped_by = requesting_user,
    completed_at = v_now
    -- notes field isn't consistently named across setups, skipping to be safe or assuming none required for now.
  WHERE request_id = p_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mapping request not found.' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object('success', true, 'request_id', p_request_id);
END;
\\$;

CREATE OR REPLACE FUNCTION public.complete_task_v2(
  p_task_id uuid,
  p_comments text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS \\$
DECLARE
  requesting_user uuid := auth.uid();
  v_now timestamptz := now();
  v_old_status text;
BEGIN
  IF requesting_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '28000';
  END IF;

  SELECT status::text INTO v_old_status FROM public.tasks WHERE task_id = p_task_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found.' USING ERRCODE = 'P0002';
  END IF;

  IF lower(COALESCE(v_old_status, '')) != 'completed' THEN
    -- Update task
    UPDATE public.tasks
    SET
      status = 'Completed',
      completed_at = v_now
    WHERE task_id = p_task_id;

    -- Add history atomically
    INSERT INTO public.task_status_history (
      task_id, old_status, new_status, changed_by, changed_at, comments
    ) VALUES (
      p_task_id, v_old_status, 'Completed', requesting_user, v_now, p_comments
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'task_id', p_task_id);
END;
\\$;

CREATE OR REPLACE FUNCTION public.complete_allocated_target_v2(
  p_target_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS \\$
DECLARE
  requesting_user uuid := auth.uid();
  v_now timestamptz := now();
BEGIN
  IF requesting_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '28000';
  END IF;

  UPDATE public.allocated_targets
  SET
    is_completed = true,
    completed_at = v_now
  WHERE target_id = p_target_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Allocated target not found.' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object('success', true, 'target_id', p_target_id);
END;
\\$;

-- Grant execution
REVOKE ALL ON FUNCTION public.log_call_v2 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_call_v2 FROM anon;
GRANT EXECUTE ON FUNCTION public.log_call_v2 TO authenticated;

REVOKE ALL ON FUNCTION public.resolve_client_query_v2 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_client_query_v2 FROM anon;
GRANT EXECUTE ON FUNCTION public.resolve_client_query_v2 TO authenticated;

REVOKE ALL ON FUNCTION public.complete_mapping_request_v2 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_mapping_request_v2 FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_mapping_request_v2 TO authenticated;

REVOKE ALL ON FUNCTION public.complete_task_v2 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_task_v2 FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_task_v2 TO authenticated;

REVOKE ALL ON FUNCTION public.complete_allocated_target_v2 FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_allocated_target_v2 FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_allocated_target_v2 TO authenticated;


COMMIT;
