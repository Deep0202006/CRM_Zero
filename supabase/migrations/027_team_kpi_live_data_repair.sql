-- 027_team_kpi_live_data_repair.sql
-- Final database-side Team KPI aggregation contract.
-- Apply this migration through the Supabase SQL Editor to guarantee complete
-- all-user reporting independently of source-table RLS and to enable immediate
-- realtime refreshes. The application retains a server-side RLS fallback only
-- as a safe degraded mode before this migration is installed.

-- Query-supporting indexes. The names match migration 026 so this migration is
-- safe whether or not that earlier Team KPI attempt was manually applied.
CREATE INDEX IF NOT EXISTS idx_tasks_kpi_completed_at_user
  ON public.tasks (completed_at, assigned_to)
  WHERE status = 'Completed' AND completed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_task_status_history_kpi_completed_at_user
  ON public.task_status_history (changed_at, changed_by, task_id)
  WHERE new_status = 'Completed';

CREATE INDEX IF NOT EXISTS idx_client_queries_kpi_resolved_at_user
  ON public.client_queries (resolved_at, resolved_by)
  WHERE problem_status = 'Resolved' AND resolved_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mapping_requests_kpi_completed_at_user
  ON public.mapping_requests (completed_at, mapped_by)
  WHERE status = 'Completed' AND completed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_call_logs_kpi_timestamp_user
  ON public.call_logs (timestamp, user_id);

CREATE INDEX IF NOT EXISTS idx_allocated_targets_kpi_completed_at_user
  ON public.allocated_targets (completed_at, assigned_to_user_id)
  WHERE is_completed = true AND completed_at IS NOT NULL;

-- Realtime never changes counters directly. It only asks the page to rerun the
-- authoritative report. Add source tables idempotently when Realtime exists.
DO $$
DECLARE
  source_table text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    FOREACH source_table IN ARRAY ARRAY[
      'users',
      'user_capabilities',
      'tasks',
      'task_status_history',
      'allocated_targets',
      'call_logs',
      'client_queries',
      'mapping_requests'
    ]
    LOOP
      IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_publication_tables publication_table
        WHERE publication_table.pubname = 'supabase_realtime'
          AND publication_table.schemaname = 'public'
          AND publication_table.tablename = source_table
      ) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', source_table);
      END IF;
    END LOOP;
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.get_team_kpi_daily(text);
DROP FUNCTION IF EXISTS public.get_team_kpi_daily(date);

CREATE OR REPLACE FUNCTION public.get_team_kpi_daily(target_date date)
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
    FROM public.user_capabilities uc
    WHERE uc.user_id = requesting_user_id
      AND uc.capability_code = 'admin'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Administrator access required';
  END IF;

  WITH
  bounds AS (
    SELECT
      target_date::timestamp AT TIME ZONE 'Asia/Kolkata' AS starts_at,
      (target_date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata' AS ends_at
  ),
  active_users AS (
    SELECT u.user_id, u.name
    FROM public.users u
    WHERE lower(COALESCE(u.is_active::text, 'false')) IN ('1', 'true', 't')
  ),
  capability_rollup AS (
    SELECT
      uc.user_id,
      array_agg(DISTINCT uc.capability_code ORDER BY uc.capability_code) AS capability_codes,
      string_agg(
        DISTINCT COALESCE(c.label, initcap(replace(uc.capability_code, '_', ' '))),
        ' · '
        ORDER BY COALESCE(c.label, initcap(replace(uc.capability_code, '_', ' ')))
      ) AS role_label
    FROM public.user_capabilities uc
    LEFT JOIN public.capabilities c ON c.code = uc.capability_code
    GROUP BY uc.user_id
  ),
  day_task_history AS (
    SELECT DISTINCT ON (h.task_id)
      h.task_id,
      COALESCE(h.changed_by, t.assigned_to) AS user_id,
      h.changed_at AS completed_at
    FROM public.task_status_history h
    JOIN public.tasks t ON t.task_id = h.task_id
    CROSS JOIN bounds b
    WHERE h.new_status = 'Completed'
      AND COALESCE(h.changed_by, t.assigned_to) IS NOT NULL
      AND h.changed_at >= b.starts_at
      AND h.changed_at < b.ends_at
    ORDER BY h.task_id, h.changed_at DESC, h.id
  ),
  legacy_completed_tasks AS (
    SELECT
      t.task_id,
      t.assigned_to AS user_id,
      t.completed_at
    FROM public.tasks t
    CROSS JOIN bounds b
    WHERE t.status = 'Completed'
      AND t.assigned_to IS NOT NULL
      AND t.completed_at IS NOT NULL
      AND t.completed_at >= b.starts_at
      AND t.completed_at < b.ends_at
      AND NOT EXISTS (
        SELECT 1
        FROM public.task_status_history h
        WHERE h.task_id = t.task_id
          AND h.new_status = 'Completed'
      )
  ),
  normal_task_events AS (
    SELECT task_id, user_id, completed_at FROM day_task_history
    UNION ALL
    SELECT task_id, user_id, completed_at FROM legacy_completed_tasks
  ),
  spreadsheet_task_events AS (
    SELECT
      target.target_id,
      target.assigned_to_user_id AS user_id,
      target.completed_at
    FROM public.allocated_targets target
    CROSS JOIN bounds b
    WHERE target.is_completed = true
      AND target.assigned_to_user_id IS NOT NULL
      AND target.completed_at IS NOT NULL
      AND target.completed_at >= b.starts_at
      AND target.completed_at < b.ends_at
  ),
  completed_tasks AS (
    SELECT user_id, count(*)::integer AS total, max(completed_at) AS latest_at
    FROM (
      SELECT 'task:' || task_id::text AS work_id, user_id, completed_at FROM normal_task_events
      UNION ALL
      SELECT 'target:' || target_id::text AS work_id, user_id, completed_at FROM spreadsheet_task_events
    ) task_events
    GROUP BY user_id
  ),
  logged_calls AS (
    SELECT c.user_id, count(DISTINCT c.log_id)::integer AS total, max(c.timestamp) AS latest_at
    FROM public.call_logs c
    CROSS JOIN bounds b
    WHERE c.user_id IS NOT NULL
      AND c.timestamp >= b.starts_at
      AND c.timestamp < b.ends_at
      AND position('→' IN COALESCE(c.outcome, '')) = 0
    GROUP BY c.user_id
  ),
  resolved_queries AS (
    SELECT
      COALESCE(q.resolved_by, q.assigned_to) AS user_id,
      count(DISTINCT q.query_id)::integer AS total,
      max(q.resolved_at) AS latest_at
    FROM public.client_queries q
    CROSS JOIN bounds b
    WHERE q.problem_status = 'Resolved'
      AND q.resolved_at IS NOT NULL
      AND COALESCE(q.resolved_by, q.assigned_to) IS NOT NULL
      AND q.resolved_at >= b.starts_at
      AND q.resolved_at < b.ends_at
    GROUP BY COALESCE(q.resolved_by, q.assigned_to)
  ),
  completed_mappings AS (
    SELECT
      m.mapped_by AS user_id,
      count(DISTINCT m.request_id)::integer AS total,
      max(m.completed_at) AS latest_at
    FROM public.mapping_requests m
    CROSS JOIN bounds b
    WHERE m.status = 'Completed'
      AND m.mapped_by IS NOT NULL
      AND m.completed_at IS NOT NULL
      AND m.completed_at >= b.starts_at
      AND m.completed_at < b.ends_at
    GROUP BY m.mapped_by
  ),
  report_rows AS (
    SELECT
      u.user_id,
      u.name,
      COALESCE(cr.role_label, 'Team member') AS role,
      COALESCE(cr.capability_codes, ARRAY[]::text[]) AS capabilities,
      COALESCE(lc.total, 0) AS calls_made,
      COALESCE(rq.total, 0) AS queries_handled,
      COALESCE(cm.total, 0) AS mappings_completed,
      COALESCE(ct.total, 0) AS tasks_completed,
      COALESCE(lc.total, 0) + COALESCE(rq.total, 0) + COALESCE(cm.total, 0) + COALESCE(ct.total, 0) AS total_completed_work,
      CASE
        WHEN lc.latest_at IS NULL AND rq.latest_at IS NULL AND cm.latest_at IS NULL AND ct.latest_at IS NULL THEN NULL
        ELSE greatest(lc.latest_at, rq.latest_at, cm.latest_at, ct.latest_at)
      END AS latest_activity_time
    FROM active_users u
    LEFT JOIN capability_rollup cr ON cr.user_id = u.user_id
    LEFT JOIN logged_calls lc ON lc.user_id = u.user_id
    LEFT JOIN resolved_queries rq ON rq.user_id = u.user_id
    LEFT JOIN completed_mappings cm ON cm.user_id = u.user_id
    LEFT JOIN completed_tasks ct ON ct.user_id = u.user_id
  )
  SELECT jsonb_build_object(
    'target_date', target_date::text,
    'generated_at', now(),
    'source', 'database-rpc',
    'warnings', '[]'::jsonb,
    'rows', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'user_id', r.user_id,
          'name', r.name,
          'role', r.role,
          'capabilities', to_jsonb(r.capabilities),
          'calls_made', r.calls_made,
          'queries_handled', r.queries_handled,
          'mappings_completed', r.mappings_completed,
          'tasks_completed', r.tasks_completed,
          'total_completed_work', r.total_completed_work,
          'latest_activity_time', r.latest_activity_time
        ) ORDER BY r.total_completed_work DESC, lower(r.name), r.user_id
      ) FROM report_rows r
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

REVOKE ALL ON FUNCTION public.get_team_kpi_daily(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_team_kpi_daily(date) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_team_kpi_daily(date) TO authenticated;

COMMENT ON FUNCTION public.get_team_kpi_daily(date) IS
  'Admin-only daily Team KPI aggregation from confirmed domain work records using Asia/Kolkata day boundaries.';
