-- ZeroData CRM — Team KPI source-of-truth and source-sync repair
-- Forward-only migration. This migration does not delete business records.

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Call logs may represent either a CRM lead or an Excel/client-directory row.
--    Older clients stored EXCEL::<username>::<name> in lead_id, which is a UUID
--    foreign key and therefore could never synchronize to PostgreSQL.
-- -----------------------------------------------------------------------------
ALTER TABLE public.call_logs
  ADD COLUMN IF NOT EXISTS client_username text,
  ADD COLUMN IF NOT EXISTS client_name text;

ALTER TABLE public.call_logs
  ALTER COLUMN lead_id DROP NOT NULL;

ALTER TABLE public.call_logs
  DROP CONSTRAINT IF EXISTS call_logs_client_reference_check;
ALTER TABLE public.call_logs
  ADD CONSTRAINT call_logs_client_reference_check
  CHECK (
    lead_id IS NOT NULL
    OR (
      NULLIF(btrim(client_username), '') IS NOT NULL
      AND NULLIF(btrim(client_name), '') IS NOT NULL
    )
  ) NOT VALID;

ALTER TABLE public.client_queries
  ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES public.users(user_id),
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolution_notes text;

CREATE INDEX IF NOT EXISTS idx_call_logs_kpi_user_timestamp
  ON public.call_logs (user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_client_queries_kpi_resolver_time
  ON public.client_queries (resolved_by, resolved_at DESC)
  WHERE problem_status = 'Resolved';
CREATE INDEX IF NOT EXISTS idx_mapping_requests_kpi_mapper_time
  ON public.mapping_requests (mapped_by, completed_at DESC)
  WHERE status IN ('Completed', 'Resolved');
CREATE INDEX IF NOT EXISTS idx_tasks_kpi_assignee_completion
  ON public.tasks (assigned_to, completed_at DESC)
  WHERE status = 'Completed';
CREATE INDEX IF NOT EXISTS idx_task_history_kpi_actor_time
  ON public.task_status_history (changed_by, changed_at DESC, task_id)
  WHERE new_status = 'Completed';
CREATE INDEX IF NOT EXISTS idx_allocated_targets_kpi_user_time
  ON public.allocated_targets (assigned_to_user_id, completed_at DESC)
  WHERE is_completed = true;

DO $publication$
DECLARE
  source_table text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH source_table IN ARRAY ARRAY[
      'users',
      'user_capabilities',
      'call_logs',
      'client_queries',
      'mapping_requests',
      'mappings',
      'tasks',
      'task_status_history',
      'allocated_targets'
    ]
    LOOP
      IF to_regclass(format('public.%I', source_table)) IS NOT NULL
         AND NOT EXISTS (
           SELECT 1
           FROM pg_publication_tables
           WHERE pubname = 'supabase_realtime'
             AND schemaname = 'public'
             AND tablename = source_table
         ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', source_table);
      END IF;
    END LOOP;
  END IF;
END
$publication$;

-- Migration 028 introduced an intermediate Team KPI event ledger. The repaired
-- report below reads authoritative source tables directly, so its capture
-- triggers and Realtime publication are retired to avoid duplicate writes and
-- refresh noise. Historical ledger rows and functions are intentionally kept.
DO $retire_ledger$
BEGIN
  IF to_regclass('public.call_logs') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS team_kpi_call_log_event ON public.call_logs;
    DROP TRIGGER IF EXISTS team_kpi_call_log_delete_event ON public.call_logs;
  END IF;
  IF to_regclass('public.client_queries') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS team_kpi_client_query_event ON public.client_queries;
    DROP TRIGGER IF EXISTS team_kpi_client_query_delete_event ON public.client_queries;
  END IF;
  IF to_regclass('public.mapping_requests') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS team_kpi_mapping_request_event ON public.mapping_requests;
    DROP TRIGGER IF EXISTS team_kpi_mapping_request_delete_event ON public.mapping_requests;
  END IF;
  IF to_regclass('public.task_status_history') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS team_kpi_task_history_event ON public.task_status_history;
    DROP TRIGGER IF EXISTS team_kpi_task_history_delete_event ON public.task_status_history;
  END IF;
  IF to_regclass('public.tasks') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS team_kpi_task_event ON public.tasks;
    DROP TRIGGER IF EXISTS team_kpi_task_delete_event ON public.tasks;
  END IF;
  IF to_regclass('public.allocated_targets') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS team_kpi_allocated_target_event ON public.allocated_targets;
    DROP TRIGGER IF EXISTS team_kpi_allocated_target_delete_event ON public.allocated_targets;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND EXISTS (
       SELECT 1
       FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'team_work_events'
     ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime DROP TABLE public.team_work_events';
  END IF;
END
$retire_ledger$;

-- Add narrow own-record policies required by the repaired call workflow. Existing
-- broader policies are preserved so this migration does not remove an approved
-- segment-support workflow from older installations.
DROP POLICY IF EXISTS call_logs_select_own_or_admin ON public.call_logs;
DROP POLICY IF EXISTS call_logs_insert_own ON public.call_logs;
DROP POLICY IF EXISTS call_logs_update_own_or_admin ON public.call_logs;
DROP POLICY IF EXISTS call_logs_delete_own_or_admin ON public.call_logs;

ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY call_logs_select_own_or_admin
ON public.call_logs
FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.user_capabilities admin_capability
    WHERE admin_capability.user_id = auth.uid()
      AND admin_capability.capability_code = 'admin'
  )
);

CREATE POLICY call_logs_insert_own
ON public.call_logs
FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());

CREATE POLICY call_logs_update_own_or_admin
ON public.call_logs
FOR UPDATE TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.user_capabilities admin_capability
    WHERE admin_capability.user_id = auth.uid()
      AND admin_capability.capability_code = 'admin'
  )
)
WITH CHECK (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.user_capabilities admin_capability
    WHERE admin_capability.user_id = auth.uid()
      AND admin_capability.capability_code = 'admin'
  )
);

CREATE POLICY call_logs_delete_own_or_admin
ON public.call_logs
FOR DELETE TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1
    FROM public.user_capabilities admin_capability
    WHERE admin_capability.user_id = auth.uid()
      AND admin_capability.capability_code = 'admin'
  )
);

-- -----------------------------------------------------------------------------
-- 2. Authoritative daily Team KPI RPC.
--    - Reads retained source records directly; no Activity Deck or snapshots.
--    - Includes every active human user, including zero-work users.
--    - Uses India business dates and durable completion timestamps.
--    - Adapts to known historical schema variants without hiding failures.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_team_kpi_daily_v4(p_target_date date)
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
AS $function$
DECLARE
  requesting_user uuid := auth.uid();
  has_resolved_by boolean;
  has_mapping_request_shape boolean;
  has_legacy_mapping_shape boolean;
BEGIN
  IF requesting_user IS NULL THEN
    RAISE EXCEPTION 'Authentication required for Team KPI.' USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.users requesting_profile
    WHERE requesting_profile.user_id = requesting_user
      AND lower(COALESCE(requesting_profile.is_active::text, 'false')) IN ('1', 'true', 't')
  ) THEN
    RAISE EXCEPTION 'The requesting account is inactive.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_capabilities requesting_capability
    WHERE requesting_capability.user_id = requesting_user
      AND requesting_capability.capability_code = 'admin'
  ) THEN
    RAISE EXCEPTION 'Administrator access is required for Team KPI.' USING ERRCODE = '42501';
  END IF;

  IF p_target_date IS NULL THEN
    RAISE EXCEPTION 'A target date is required.' USING ERRCODE = '22023';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS team_kpi_events_v4 (
    event_key text PRIMARY KEY,
    event_user_id uuid NOT NULL,
    event_type text NOT NULL,
    event_at timestamptz NOT NULL
  ) ON COMMIT DROP;
  TRUNCATE TABLE pg_temp.team_kpi_events_v4;

  -- Calls: count real call rows exactly once and exclude synthetic pipeline notes.
  IF to_regclass('public.call_logs') IS NOT NULL THEN
    INSERT INTO pg_temp.team_kpi_events_v4 (event_key, event_user_id, event_type, event_at)
    SELECT
      'call:' || call_log.log_id::text,
      call_log.user_id,
      'call',
      call_log.timestamp
    FROM public.call_logs call_log
    WHERE call_log.user_id IS NOT NULL
      AND call_log.timestamp IS NOT NULL
      AND (call_log.timestamp AT TIME ZONE 'Asia/Kolkata')::date = p_target_date
      AND COALESCE(call_log.outcome, '') !~* '^\s*(\[.*\]\s*(→|->)|pipeline\s+stage)'
    ON CONFLICT (event_key) DO NOTHING;
  END IF;

  -- Resolved client queries: prefer the actual resolver, fall back to assignee only
  -- for historical rows created before resolved_by existed.
  IF to_regclass('public.client_queries') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'client_queries' AND column_name = 'resolved_at'
     ) THEN
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'client_queries' AND column_name = 'resolved_by'
    ) INTO has_resolved_by;

    IF has_resolved_by THEN
      EXECUTE $query$
        INSERT INTO pg_temp.team_kpi_events_v4 (event_key, event_user_id, event_type, event_at)
        SELECT
          'query:' || query_row.query_id::text,
          COALESCE(query_row.resolved_by, query_row.assigned_to),
          'client_query',
          query_row.resolved_at
        FROM public.client_queries query_row
        WHERE lower(COALESCE(query_row.problem_status, '')) = 'resolved'
          AND query_row.resolved_at IS NOT NULL
          AND COALESCE(query_row.resolved_by, query_row.assigned_to) IS NOT NULL
          AND (query_row.resolved_at AT TIME ZONE 'Asia/Kolkata')::date = $1
        ON CONFLICT (event_key) DO NOTHING
      $query$ USING p_target_date;
    ELSE
      EXECUTE $query$
        INSERT INTO pg_temp.team_kpi_events_v4 (event_key, event_user_id, event_type, event_at)
        SELECT
          'query:' || query_row.query_id::text,
          query_row.assigned_to,
          'client_query',
          query_row.resolved_at
        FROM public.client_queries query_row
        WHERE lower(COALESCE(query_row.problem_status, '')) = 'resolved'
          AND query_row.resolved_at IS NOT NULL
          AND query_row.assigned_to IS NOT NULL
          AND (query_row.resolved_at AT TIME ZONE 'Asia/Kolkata')::date = $1
        ON CONFLICT (event_key) DO NOTHING
      $query$ USING p_target_date;
    END IF;
  END IF;

  -- Current mapping request workflow.
  SELECT
    to_regclass('public.mapping_requests') IS NOT NULL
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'mapping_requests' AND column_name = 'mapped_by')
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'mapping_requests' AND column_name = 'completed_at')
  INTO has_mapping_request_shape;

  IF has_mapping_request_shape THEN
    EXECUTE $mapping$
      INSERT INTO pg_temp.team_kpi_events_v4 (event_key, event_user_id, event_type, event_at)
      SELECT
        'mapping-request:' || mapping_request.request_id::text,
        mapping_request.mapped_by,
        'mapping',
        mapping_request.completed_at
      FROM public.mapping_requests mapping_request
      WHERE lower(COALESCE(mapping_request.status, '')) IN ('completed', 'resolved')
        AND mapping_request.mapped_by IS NOT NULL
        AND mapping_request.completed_at IS NOT NULL
        AND (mapping_request.completed_at AT TIME ZONE 'Asia/Kolkata')::date = $1
      ON CONFLICT (event_key) DO NOTHING
    $mapping$ USING p_target_date;
  END IF;

  -- Historical mappings table retained by older installations.
  SELECT
    to_regclass('public.mappings') IS NOT NULL
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'mappings' AND column_name = 'mapped_by')
    AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'mappings' AND column_name = 'completion_timestamp')
  INTO has_legacy_mapping_shape;

  IF has_legacy_mapping_shape THEN
    EXECUTE $mapping$
      INSERT INTO pg_temp.team_kpi_events_v4 (event_key, event_user_id, event_type, event_at)
      SELECT
        'mapping:' || mapping_row.mapping_id::text,
        mapping_row.mapped_by,
        'mapping',
        mapping_row.completion_timestamp
      FROM public.mappings mapping_row
      WHERE mapping_row.mapped_by IS NOT NULL
        AND mapping_row.completion_timestamp IS NOT NULL
        AND (mapping_row.completion_timestamp AT TIME ZONE 'Asia/Kolkata')::date = $1
      ON CONFLICT (event_key) DO NOTHING
    $mapping$ USING p_target_date;
  END IF;

  -- Immutable task-completion history. Count each task at most once per India day.
  IF to_regclass('public.task_status_history') IS NOT NULL
     AND to_regclass('public.tasks') IS NOT NULL THEN
    INSERT INTO pg_temp.team_kpi_events_v4 (event_key, event_user_id, event_type, event_at)
    SELECT DISTINCT ON (
      task_history.task_id,
      (task_history.changed_at AT TIME ZONE 'Asia/Kolkata')::date
    )
      'task-history:' || task_history.task_id::text || ':' ||
        ((task_history.changed_at AT TIME ZONE 'Asia/Kolkata')::date)::text,
      COALESCE(task_history.changed_by, task_row.assigned_to),
      'task',
      task_history.changed_at
    FROM public.task_status_history task_history
    LEFT JOIN public.tasks task_row ON task_row.task_id = task_history.task_id
    WHERE lower(COALESCE(task_history.new_status, '')) = 'completed'
      AND task_history.changed_at IS NOT NULL
      AND COALESCE(task_history.changed_by, task_row.assigned_to) IS NOT NULL
      AND (task_history.changed_at AT TIME ZONE 'Asia/Kolkata')::date = p_target_date
    ORDER BY
      task_history.task_id,
      (task_history.changed_at AT TIME ZONE 'Asia/Kolkata')::date,
      task_history.changed_at DESC
    ON CONFLICT (event_key) DO NOTHING;
  END IF;

  -- Current completed tasks without any completion-history event.
  IF to_regclass('public.tasks') IS NOT NULL THEN
    INSERT INTO pg_temp.team_kpi_events_v4 (event_key, event_user_id, event_type, event_at)
    SELECT
      'task-row:' || task_row.task_id::text,
      task_row.assigned_to,
      'task',
      task_row.completed_at
    FROM public.tasks task_row
    WHERE lower(COALESCE(task_row.status::text, '')) = 'completed'
      AND task_row.assigned_to IS NOT NULL
      AND task_row.completed_at IS NOT NULL
      AND (task_row.completed_at AT TIME ZONE 'Asia/Kolkata')::date = p_target_date
      AND NOT EXISTS (
        SELECT 1
        FROM public.task_status_history completion_history
        WHERE completion_history.task_id = task_row.task_id
          AND lower(COALESCE(completion_history.new_status, '')) = 'completed'
      )
    ON CONFLICT (event_key) DO NOTHING;
  END IF;

  -- Spreadsheet/My Day targets are completed work and use their original timestamp.
  IF to_regclass('public.allocated_targets') IS NOT NULL THEN
    INSERT INTO pg_temp.team_kpi_events_v4 (event_key, event_user_id, event_type, event_at)
    SELECT
      'allocated-target:' || target_row.target_id::text,
      target_row.assigned_to_user_id,
      'task',
      target_row.completed_at
    FROM public.allocated_targets target_row
    WHERE target_row.is_completed = true
      AND target_row.assigned_to_user_id IS NOT NULL
      AND target_row.completed_at IS NOT NULL
      AND (target_row.completed_at AT TIME ZONE 'Asia/Kolkata')::date = p_target_date
    ON CONFLICT (event_key) DO NOTHING;
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
      event.event_user_id,
      count(*) FILTER (WHERE event.event_type = 'call')::integer AS calls,
      count(*) FILTER (WHERE event.event_type = 'client_query')::integer AS client_queries,
      count(*) FILTER (WHERE event.event_type = 'mapping')::integer AS mappings,
      count(*) FILTER (WHERE event.event_type = 'task')::integer AS tasks,
      max(event.event_at) AS latest_activity
    FROM pg_temp.team_kpi_events_v4 event
    GROUP BY event.event_user_id
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
$function$;

REVOKE ALL ON FUNCTION public.get_team_kpi_daily_v4(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_team_kpi_daily_v4(date) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_team_kpi_daily_v4(date) TO authenticated;

COMMENT ON FUNCTION public.get_team_kpi_daily_v4(date) IS
  'Admin-only daily Team KPI report from retained source records using Asia/Kolkata business dates.';

COMMIT;
