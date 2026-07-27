-- 028_team_kpi_event_ledger.sql
-- Durable Team KPI event ledger.
--
-- Purpose:
--   1. Backfill all retained historical KPI work from authoritative domain tables.
--   2. Capture future completed work exactly once through narrow database triggers.
--   3. Serve Team KPI from one stable ledger instead of repeatedly joining drifting
--      operational schemas at page-load time.
--
-- This migration is additive. It does not delete or rewrite calls, client queries,
-- mappings, tasks, allocated targets, users, or historical KPI snapshot data.

BEGIN;

-- Fail early with one explicit message rather than creating a partially usable KPI.
DO $$
DECLARE
  missing_columns text[];
BEGIN
  WITH required_columns(table_name, column_name) AS (
    VALUES
      ('users', 'user_id'),
      ('users', 'name'),
      ('users', 'is_active'),
      ('user_capabilities', 'user_id'),
      ('user_capabilities', 'capability_code'),
      ('capabilities', 'code'),
      ('capabilities', 'label'),
      ('call_logs', 'log_id'),
      ('call_logs', 'user_id'),
      ('call_logs', 'timestamp'),
      ('call_logs', 'outcome'),
      ('client_queries', 'query_id'),
      ('client_queries', 'assigned_to'),
      ('client_queries', 'resolved_by'),
      ('client_queries', 'resolved_at'),
      ('client_queries', 'problem_status'),
      ('mapping_requests', 'request_id'),
      ('mapping_requests', 'mapped_by'),
      ('mapping_requests', 'completed_at'),
      ('mapping_requests', 'status'),
      ('tasks', 'task_id'),
      ('tasks', 'assigned_to'),
      ('tasks', 'completed_at'),
      ('tasks', 'status'),
      ('task_status_history', 'id'),
      ('task_status_history', 'task_id'),
      ('task_status_history', 'changed_by'),
      ('task_status_history', 'changed_at'),
      ('task_status_history', 'new_status'),
      ('allocated_targets', 'target_id'),
      ('allocated_targets', 'assigned_to_user_id'),
      ('allocated_targets', 'completed_at'),
      ('allocated_targets', 'is_completed')
  )
  SELECT array_agg(format('%I.%I', required_columns.table_name, required_columns.column_name)
                   ORDER BY required_columns.table_name, required_columns.column_name)
  INTO missing_columns
  FROM required_columns
  LEFT JOIN information_schema.columns existing_column
    ON existing_column.table_schema = 'public'
   AND existing_column.table_name = required_columns.table_name
   AND existing_column.column_name = required_columns.column_name
  WHERE existing_column.column_name IS NULL;

  IF missing_columns IS NOT NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '42703',
      MESSAGE = 'Team KPI migration 028 cannot run because required source columns are missing: '
        || array_to_string(missing_columns, ', '),
      HINT = 'Do not partially apply this migration. Correct the live schema or use the matching current repository migration first.';
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS public.team_work_events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL UNIQUE,
  metric_type text NOT NULL CHECK (metric_type IN ('calls', 'client_queries', 'mappings', 'tasks')),
  source_table text NOT NULL CHECK (source_table IN ('call_logs', 'client_queries', 'mapping_requests', 'tasks', 'task_status_history', 'allocated_targets')),
  source_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES public.users(user_id) ON DELETE CASCADE,
  occurred_at timestamptz NOT NULL,
  business_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_team_work_events_date_user
  ON public.team_work_events (business_date DESC, user_id);
CREATE INDEX IF NOT EXISTS idx_team_work_events_user_date
  ON public.team_work_events (user_id, business_date DESC);
CREATE INDEX IF NOT EXISTS idx_team_work_events_metric_date
  ON public.team_work_events (metric_type, business_date DESC);
CREATE INDEX IF NOT EXISTS idx_team_work_events_occurred_at
  ON public.team_work_events (occurred_at DESC);

ALTER TABLE public.team_work_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS team_work_events_admin_read ON public.team_work_events;
CREATE POLICY team_work_events_admin_read
ON public.team_work_events
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_capabilities capability
    WHERE capability.user_id = auth.uid()
      AND capability.capability_code = 'admin'
  )
);

REVOKE ALL ON TABLE public.team_work_events FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.team_work_events FROM authenticated;
GRANT SELECT ON TABLE public.team_work_events TO authenticated;

CREATE OR REPLACE FUNCTION public.team_kpi_upsert_event(
  p_event_key text,
  p_metric_type text,
  p_source_table text,
  p_source_id uuid,
  p_user_id uuid,
  p_occurred_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_event_key IS NULL OR btrim(p_event_key) = '' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Team KPI event key is required';
  END IF;
  IF p_metric_type NOT IN ('calls', 'client_queries', 'mappings', 'tasks') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Unsupported Team KPI metric type';
  END IF;
  IF p_source_table NOT IN ('call_logs', 'client_queries', 'mapping_requests', 'tasks', 'task_status_history', 'allocated_targets') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Unsupported Team KPI source table';
  END IF;
  IF p_source_id IS NULL OR p_user_id IS NULL OR p_occurred_at IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22004', MESSAGE = 'Team KPI source, user, and occurrence time are required';
  END IF;

  INSERT INTO public.team_work_events (
    event_key,
    metric_type,
    source_table,
    source_id,
    user_id,
    occurred_at,
    business_date,
    updated_at
  )
  VALUES (
    p_event_key,
    p_metric_type,
    p_source_table,
    p_source_id,
    p_user_id,
    p_occurred_at,
    (p_occurred_at AT TIME ZONE 'Asia/Kolkata')::date,
    now()
  )
  ON CONFLICT (event_key) DO UPDATE
  SET metric_type = EXCLUDED.metric_type,
      source_table = EXCLUDED.source_table,
      source_id = EXCLUDED.source_id,
      user_id = EXCLUDED.user_id,
      occurred_at = EXCLUDED.occurred_at,
      business_date = EXCLUDED.business_date,
      updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.team_kpi_upsert_event(text, text, text, uuid, uuid, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.team_kpi_upsert_event(text, text, text, uuid, uuid, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.team_kpi_upsert_event(text, text, text, uuid, uuid, timestamptz) FROM authenticated;

CREATE OR REPLACE FUNCTION public.team_kpi_capture_call_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  key text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    key := 'call:' || OLD.log_id::text;
    DELETE FROM public.team_work_events WHERE event_key = key;
    RETURN OLD;
  END IF;
  key := 'call:' || NEW.log_id::text;

  IF NEW.user_id IS NULL
     OR NEW.timestamp IS NULL
     OR position('→' IN COALESCE(NEW.outcome, '')) > 0 THEN
    DELETE FROM public.team_work_events WHERE event_key = key;
  ELSE
    PERFORM public.team_kpi_upsert_event(
      key,
      'calls',
      'call_logs',
      NEW.log_id,
      NEW.user_id,
      NEW.timestamp
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.team_kpi_capture_client_query()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  key text;
  actor uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    key := 'query:' || OLD.query_id::text;
    DELETE FROM public.team_work_events WHERE event_key = key;
    RETURN OLD;
  END IF;
  key := 'query:' || NEW.query_id::text;

  actor := COALESCE(NEW.resolved_by, NEW.assigned_to);
  IF NEW.problem_status <> 'Resolved' OR NEW.resolved_at IS NULL OR actor IS NULL THEN
    DELETE FROM public.team_work_events WHERE event_key = key;
  ELSE
    PERFORM public.team_kpi_upsert_event(
      key,
      'client_queries',
      'client_queries',
      NEW.query_id,
      actor,
      NEW.resolved_at
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.team_kpi_capture_mapping_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  key text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    key := 'mapping:' || OLD.request_id::text;
    DELETE FROM public.team_work_events WHERE event_key = key;
    RETURN OLD;
  END IF;
  key := 'mapping:' || NEW.request_id::text;

  IF NEW.status <> 'Completed' OR NEW.completed_at IS NULL OR NEW.mapped_by IS NULL THEN
    DELETE FROM public.team_work_events WHERE event_key = key;
  ELSE
    PERFORM public.team_kpi_upsert_event(
      key,
      'mappings',
      'mapping_requests',
      NEW.request_id,
      NEW.mapped_by,
      NEW.completed_at
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.team_kpi_capture_task_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  key text;
  actor uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    key := 'task-history:' || OLD.id::text;
    DELETE FROM public.team_work_events WHERE event_key = key;
    RETURN OLD;
  END IF;
  key := 'task-history:' || NEW.id::text;

  SELECT COALESCE(NEW.changed_by, task.assigned_to)
  INTO actor
  FROM public.tasks task
  WHERE task.task_id = NEW.task_id;

  IF NEW.new_status <> 'Completed' OR NEW.changed_at IS NULL OR actor IS NULL THEN
    DELETE FROM public.team_work_events WHERE event_key = key;
  ELSE
    -- Completion history is more authoritative than the legacy current task row.
    DELETE FROM public.team_work_events WHERE event_key = 'task:' || NEW.task_id::text;
    PERFORM public.team_kpi_upsert_event(
      key,
      'tasks',
      'task_status_history',
      NEW.id,
      actor,
      NEW.changed_at
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.team_kpi_capture_task()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  key text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    key := 'task:' || OLD.task_id::text;
    DELETE FROM public.team_work_events WHERE event_key = key;
    RETURN OLD;
  END IF;
  key := 'task:' || NEW.task_id::text;

  IF NEW.status <> 'Completed'
     OR NEW.completed_at IS NULL
     OR NEW.assigned_to IS NULL
     OR EXISTS (
       SELECT 1
       FROM public.task_status_history history
       WHERE history.task_id = NEW.task_id
         AND history.new_status = 'Completed'
     ) THEN
    DELETE FROM public.team_work_events WHERE event_key = key;
  ELSE
    PERFORM public.team_kpi_upsert_event(
      key,
      'tasks',
      'tasks',
      NEW.task_id,
      NEW.assigned_to,
      NEW.completed_at
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.team_kpi_capture_allocated_target()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  key text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    key := 'target:' || OLD.target_id::text;
    DELETE FROM public.team_work_events WHERE event_key = key;
    RETURN OLD;
  END IF;
  key := 'target:' || NEW.target_id::text;

  IF NEW.is_completed IS DISTINCT FROM true
     OR NEW.completed_at IS NULL
     OR NEW.assigned_to_user_id IS NULL THEN
    DELETE FROM public.team_work_events WHERE event_key = key;
  ELSE
    PERFORM public.team_kpi_upsert_event(
      key,
      'tasks',
      'allocated_targets',
      NEW.target_id,
      NEW.assigned_to_user_id,
      NEW.completed_at
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.team_kpi_capture_call_log() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_kpi_capture_client_query() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_kpi_capture_mapping_request() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_kpi_capture_task_history() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_kpi_capture_task() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.team_kpi_capture_allocated_target() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS team_kpi_call_log_event ON public.call_logs;
DROP TRIGGER IF EXISTS team_kpi_call_log_delete_event ON public.call_logs;
CREATE TRIGGER team_kpi_call_log_event
AFTER INSERT OR UPDATE OF user_id, timestamp, outcome
ON public.call_logs
FOR EACH ROW EXECUTE FUNCTION public.team_kpi_capture_call_log();
CREATE TRIGGER team_kpi_call_log_delete_event
AFTER DELETE ON public.call_logs
FOR EACH ROW EXECUTE FUNCTION public.team_kpi_capture_call_log();

DROP TRIGGER IF EXISTS team_kpi_client_query_event ON public.client_queries;
DROP TRIGGER IF EXISTS team_kpi_client_query_delete_event ON public.client_queries;
CREATE TRIGGER team_kpi_client_query_event
AFTER INSERT OR UPDATE OF assigned_to, resolved_by, resolved_at, problem_status
ON public.client_queries
FOR EACH ROW EXECUTE FUNCTION public.team_kpi_capture_client_query();
CREATE TRIGGER team_kpi_client_query_delete_event
AFTER DELETE ON public.client_queries
FOR EACH ROW EXECUTE FUNCTION public.team_kpi_capture_client_query();

DROP TRIGGER IF EXISTS team_kpi_mapping_request_event ON public.mapping_requests;
DROP TRIGGER IF EXISTS team_kpi_mapping_request_delete_event ON public.mapping_requests;
CREATE TRIGGER team_kpi_mapping_request_event
AFTER INSERT OR UPDATE OF mapped_by, completed_at, status
ON public.mapping_requests
FOR EACH ROW EXECUTE FUNCTION public.team_kpi_capture_mapping_request();
CREATE TRIGGER team_kpi_mapping_request_delete_event
AFTER DELETE ON public.mapping_requests
FOR EACH ROW EXECUTE FUNCTION public.team_kpi_capture_mapping_request();

DROP TRIGGER IF EXISTS team_kpi_task_history_event ON public.task_status_history;
DROP TRIGGER IF EXISTS team_kpi_task_history_delete_event ON public.task_status_history;
CREATE TRIGGER team_kpi_task_history_event
AFTER INSERT OR UPDATE OF task_id, changed_by, changed_at, new_status
ON public.task_status_history
FOR EACH ROW EXECUTE FUNCTION public.team_kpi_capture_task_history();
CREATE TRIGGER team_kpi_task_history_delete_event
AFTER DELETE ON public.task_status_history
FOR EACH ROW EXECUTE FUNCTION public.team_kpi_capture_task_history();

DROP TRIGGER IF EXISTS team_kpi_task_event ON public.tasks;
DROP TRIGGER IF EXISTS team_kpi_task_delete_event ON public.tasks;
CREATE TRIGGER team_kpi_task_event
AFTER INSERT OR UPDATE OF assigned_to, completed_at, status
ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.team_kpi_capture_task();
CREATE TRIGGER team_kpi_task_delete_event
AFTER DELETE ON public.tasks
FOR EACH ROW EXECUTE FUNCTION public.team_kpi_capture_task();

DROP TRIGGER IF EXISTS team_kpi_allocated_target_event ON public.allocated_targets;
DROP TRIGGER IF EXISTS team_kpi_allocated_target_delete_event ON public.allocated_targets;
CREATE TRIGGER team_kpi_allocated_target_event
AFTER INSERT OR UPDATE OF assigned_to_user_id, completed_at, is_completed
ON public.allocated_targets
FOR EACH ROW EXECUTE FUNCTION public.team_kpi_capture_allocated_target();
CREATE TRIGGER team_kpi_allocated_target_delete_event
AFTER DELETE ON public.allocated_targets
FOR EACH ROW EXECUTE FUNCTION public.team_kpi_capture_allocated_target();

-- Backfill every retained historical source record. Each event key is stable, so
-- re-running this migration's backfill statements cannot double count work.
INSERT INTO public.team_work_events (
  event_key, metric_type, source_table, source_id, user_id, occurred_at, business_date
)
SELECT
  'call:' || call_log.log_id::text,
  'calls',
  'call_logs',
  call_log.log_id,
  call_log.user_id,
  call_log.timestamp,
  (call_log.timestamp AT TIME ZONE 'Asia/Kolkata')::date
FROM public.call_logs call_log
WHERE call_log.user_id IS NOT NULL
  AND call_log.timestamp IS NOT NULL
  AND position('→' IN COALESCE(call_log.outcome, '')) = 0
ON CONFLICT (event_key) DO UPDATE
SET user_id = EXCLUDED.user_id,
    occurred_at = EXCLUDED.occurred_at,
    business_date = EXCLUDED.business_date,
    updated_at = now();

INSERT INTO public.team_work_events (
  event_key, metric_type, source_table, source_id, user_id, occurred_at, business_date
)
SELECT
  'query:' || query.query_id::text,
  'client_queries',
  'client_queries',
  query.query_id,
  COALESCE(query.resolved_by, query.assigned_to),
  query.resolved_at,
  (query.resolved_at AT TIME ZONE 'Asia/Kolkata')::date
FROM public.client_queries query
WHERE query.problem_status = 'Resolved'
  AND query.resolved_at IS NOT NULL
  AND COALESCE(query.resolved_by, query.assigned_to) IS NOT NULL
ON CONFLICT (event_key) DO UPDATE
SET user_id = EXCLUDED.user_id,
    occurred_at = EXCLUDED.occurred_at,
    business_date = EXCLUDED.business_date,
    updated_at = now();

INSERT INTO public.team_work_events (
  event_key, metric_type, source_table, source_id, user_id, occurred_at, business_date
)
SELECT
  'mapping:' || mapping.request_id::text,
  'mappings',
  'mapping_requests',
  mapping.request_id,
  mapping.mapped_by,
  mapping.completed_at,
  (mapping.completed_at AT TIME ZONE 'Asia/Kolkata')::date
FROM public.mapping_requests mapping
WHERE mapping.status = 'Completed'
  AND mapping.mapped_by IS NOT NULL
  AND mapping.completed_at IS NOT NULL
ON CONFLICT (event_key) DO UPDATE
SET user_id = EXCLUDED.user_id,
    occurred_at = EXCLUDED.occurred_at,
    business_date = EXCLUDED.business_date,
    updated_at = now();

INSERT INTO public.team_work_events (
  event_key, metric_type, source_table, source_id, user_id, occurred_at, business_date
)
SELECT
  'task-history:' || history.id::text,
  'tasks',
  'task_status_history',
  history.id,
  COALESCE(history.changed_by, task.assigned_to),
  history.changed_at,
  (history.changed_at AT TIME ZONE 'Asia/Kolkata')::date
FROM public.task_status_history history
JOIN public.tasks task ON task.task_id = history.task_id
WHERE history.new_status = 'Completed'
  AND history.changed_at IS NOT NULL
  AND COALESCE(history.changed_by, task.assigned_to) IS NOT NULL
ON CONFLICT (event_key) DO UPDATE
SET user_id = EXCLUDED.user_id,
    occurred_at = EXCLUDED.occurred_at,
    business_date = EXCLUDED.business_date,
    updated_at = now();

INSERT INTO public.team_work_events (
  event_key, metric_type, source_table, source_id, user_id, occurred_at, business_date
)
SELECT
  'task:' || task.task_id::text,
  'tasks',
  'tasks',
  task.task_id,
  task.assigned_to,
  task.completed_at,
  (task.completed_at AT TIME ZONE 'Asia/Kolkata')::date
FROM public.tasks task
WHERE task.status = 'Completed'
  AND task.assigned_to IS NOT NULL
  AND task.completed_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.task_status_history history
    WHERE history.task_id = task.task_id
      AND history.new_status = 'Completed'
  )
ON CONFLICT (event_key) DO UPDATE
SET user_id = EXCLUDED.user_id,
    occurred_at = EXCLUDED.occurred_at,
    business_date = EXCLUDED.business_date,
    updated_at = now();

INSERT INTO public.team_work_events (
  event_key, metric_type, source_table, source_id, user_id, occurred_at, business_date
)
SELECT
  'target:' || target.target_id::text,
  'tasks',
  'allocated_targets',
  target.target_id,
  target.assigned_to_user_id,
  target.completed_at,
  (target.completed_at AT TIME ZONE 'Asia/Kolkata')::date
FROM public.allocated_targets target
WHERE target.is_completed = true
  AND target.assigned_to_user_id IS NOT NULL
  AND target.completed_at IS NOT NULL
ON CONFLICT (event_key) DO UPDATE
SET user_id = EXCLUDED.user_id,
    occurred_at = EXCLUDED.occurred_at,
    business_date = EXCLUDED.business_date,
    updated_at = now();

-- The page subscribes to this one ledger table instead of eight operational
-- tables. This materially reduces Realtime channels and refresh noise.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_publication_tables table_entry
       WHERE table_entry.pubname = 'supabase_realtime'
         AND table_entry.schemaname = 'public'
         AND table_entry.tablename = 'team_work_events'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.team_work_events;
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.get_team_kpi_daily_v3(date);
CREATE OR REPLACE FUNCTION public.get_team_kpi_daily_v3(target_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  requesting_user_id uuid := auth.uid();
  response jsonb;
BEGIN
  IF target_date IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22004', MESSAGE = 'Target date is required';
  END IF;
  IF requesting_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '28000', MESSAGE = 'Authentication required';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.user_capabilities capability
    WHERE capability.user_id = requesting_user_id
      AND capability.capability_code = 'admin'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Administrator access required';
  END IF;

  WITH active_users AS (
    SELECT user_record.user_id, user_record.name
    FROM public.users user_record
    WHERE lower(COALESCE(user_record.is_active::text, 'false')) IN ('1', 'true', 't')
  ),
  capability_rollup AS (
    SELECT
      capability.user_id,
      array_agg(DISTINCT capability.capability_code ORDER BY capability.capability_code) AS capabilities,
      string_agg(
        DISTINCT COALESCE(definition.label, initcap(replace(capability.capability_code, '_', ' '))),
        ' · '
        ORDER BY COALESCE(definition.label, initcap(replace(capability.capability_code, '_', ' ')))
      ) AS role_label
    FROM public.user_capabilities capability
    LEFT JOIN public.capabilities definition ON definition.code = capability.capability_code
    GROUP BY capability.user_id
  ),
  daily_events AS (
    SELECT
      event.user_id,
      count(*) FILTER (WHERE event.metric_type = 'calls')::integer AS calls_made,
      count(*) FILTER (WHERE event.metric_type = 'client_queries')::integer AS queries_handled,
      count(*) FILTER (WHERE event.metric_type = 'mappings')::integer AS mappings_completed,
      count(*) FILTER (WHERE event.metric_type = 'tasks')::integer AS tasks_completed,
      max(event.occurred_at) AS latest_activity_time
    FROM public.team_work_events event
    WHERE event.business_date = target_date
    GROUP BY event.user_id
  ),
  report_rows AS (
    SELECT
      active.user_id,
      active.name,
      COALESCE(roles.role_label, 'Team member') AS role,
      COALESCE(roles.capabilities, ARRAY[]::text[]) AS capabilities,
      COALESCE(events.calls_made, 0) AS calls_made,
      COALESCE(events.queries_handled, 0) AS queries_handled,
      COALESCE(events.mappings_completed, 0) AS mappings_completed,
      COALESCE(events.tasks_completed, 0) AS tasks_completed,
      COALESCE(events.calls_made, 0)
        + COALESCE(events.queries_handled, 0)
        + COALESCE(events.mappings_completed, 0)
        + COALESCE(events.tasks_completed, 0) AS total_completed_work,
      events.latest_activity_time
    FROM active_users active
    LEFT JOIN capability_rollup roles ON roles.user_id = active.user_id
    LEFT JOIN daily_events events ON events.user_id = active.user_id
  )
  SELECT jsonb_build_object(
    'target_date', target_date::text,
    'generated_at', now(),
    'source', 'team-work-events',
    'schema_version', 3,
    'warnings', '[]'::jsonb,
    'rows', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'user_id', row.user_id,
          'name', row.name,
          'role', row.role,
          'capabilities', to_jsonb(row.capabilities),
          'calls_made', row.calls_made,
          'queries_handled', row.queries_handled,
          'mappings_completed', row.mappings_completed,
          'tasks_completed', row.tasks_completed,
          'total_completed_work', row.total_completed_work,
          'latest_activity_time', row.latest_activity_time
        )
        ORDER BY row.total_completed_work DESC, lower(row.name), row.user_id
      )
      FROM report_rows row
    ), '[]'::jsonb),
    'totals', jsonb_build_object(
      'team_members', (SELECT count(*)::integer FROM report_rows),
      'calls_made', COALESCE((SELECT sum(calls_made)::integer FROM report_rows), 0),
      'queries_handled', COALESCE((SELECT sum(queries_handled)::integer FROM report_rows), 0),
      'mappings_completed', COALESCE((SELECT sum(mappings_completed)::integer FROM report_rows), 0),
      'tasks_completed', COALESCE((SELECT sum(tasks_completed)::integer FROM report_rows), 0),
      'total_completed_work', COALESCE((SELECT sum(total_completed_work)::integer FROM report_rows), 0)
    )
  ) INTO response;

  RETURN response;
END;
$$;

REVOKE ALL ON FUNCTION public.get_team_kpi_daily_v3(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_team_kpi_daily_v3(date) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_team_kpi_daily_v3(date) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_team_kpi_health_v1(target_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  requesting_user_id uuid := auth.uid();
BEGIN
  IF requesting_user_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.user_capabilities capability
    WHERE capability.user_id = requesting_user_id
      AND capability.capability_code = 'admin'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Administrator access required';
  END IF;

  RETURN jsonb_build_object(
    'target_date', target_date::text,
    'active_users', (
      SELECT count(*)::integer
      FROM public.users user_record
      WHERE lower(COALESCE(user_record.is_active::text, 'false')) IN ('1', 'true', 't')
    ),
    'events', (
      SELECT count(*)::integer
      FROM public.team_work_events event
      WHERE event.business_date = target_date
    ),
    'calls', (
      SELECT count(*)::integer FROM public.team_work_events event
      WHERE event.business_date = target_date AND event.metric_type = 'calls'
    ),
    'client_queries', (
      SELECT count(*)::integer FROM public.team_work_events event
      WHERE event.business_date = target_date AND event.metric_type = 'client_queries'
    ),
    'mappings', (
      SELECT count(*)::integer FROM public.team_work_events event
      WHERE event.business_date = target_date AND event.metric_type = 'mappings'
    ),
    'tasks', (
      SELECT count(*)::integer FROM public.team_work_events event
      WHERE event.business_date = target_date AND event.metric_type = 'tasks'
    ),
    'latest_event_at', (
      SELECT max(event.occurred_at)
      FROM public.team_work_events event
      WHERE event.business_date = target_date
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_team_kpi_health_v1(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_team_kpi_health_v1(date) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_team_kpi_health_v1(date) TO authenticated;

COMMENT ON TABLE public.team_work_events IS
  'Immutable-style, idempotent work-event ledger used only for Team KPI reporting.';
COMMENT ON FUNCTION public.get_team_kpi_daily_v3(date) IS
  'Admin-only Team KPI report sourced from the durable team_work_events ledger.';
COMMENT ON FUNCTION public.get_team_kpi_health_v1(date) IS
  'Admin-only non-sensitive Team KPI health counts for operational diagnosis.';

COMMIT;
