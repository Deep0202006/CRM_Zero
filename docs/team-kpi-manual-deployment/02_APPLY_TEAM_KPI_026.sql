-- 02_APPLY_TEAM_KPI_026.sql
-- Target feature: Team KPI.
-- Intended project reference: gwfjkpsoaoherntwhdyf.
-- Manual SQL Editor deployment.
-- Run once only.
-- Do not run when the precheck indicates it is already applied.

BEGIN;

-- 026_team_kpi_repair.sql
-- Permanent Team KPI source-of-truth repair.
--
-- This migration intentionally leaves Activity Deck and legacy KPI snapshot data
-- out of the live reporting path. Team KPI is calculated directly from the
-- authoritative work tables in one authorized database call.

-- Retire the old snapshot increment path. The historical snapshot table is kept
-- for audit compatibility, but no live workflow should write to it anymore.
DROP TRIGGER IF EXISTS on_mapping_request_completed ON public.mapping_requests;
DROP TRIGGER IF EXISTS on_client_query_resolved ON public.client_queries;
DROP FUNCTION IF EXISTS public.update_kpi_mapping_request();
DROP FUNCTION IF EXISTS public.update_kpi_client_queries();
DROP FUNCTION IF EXISTS public.compute_daily_kpi_snapshot(date);

-- Preserve who requested a mapping separately from who actually completed it.
-- Existing rows used mapped_by at creation time, so the backfill is deterministic.
ALTER TABLE public.mapping_requests
  ADD COLUMN IF NOT EXISTS requested_by uuid REFERENCES public.users(user_id) ON DELETE SET NULL;

UPDATE public.mapping_requests
SET requested_by = mapped_by
WHERE requested_by IS NULL
  AND mapped_by IS NOT NULL;

-- Query-supporting indexes. These are narrow, partial indexes for the exact
-- completion/occurrence paths used by the report.
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

-- Ensure the source tables can trigger a lightweight dashboard refresh. The
-- dashboard still re-runs the single server aggregation; it never increments
-- counters from realtime payloads.
DO $$
DECLARE
  source_table text;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_publication
    WHERE pubname = 'supabase_realtime'
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
        FROM pg_catalog.pg_publication_tables AS publication_table
        WHERE publication_table.pubname = 'supabase_realtime'
          AND publication_table.schemaname = 'public'
          AND publication_table.tablename = source_table
      ) THEN
        EXECUTE format(
          'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',
          source_table
        );
      END IF;
    END LOOP;
  END IF;
END;
$$;

-- Remove both possible signatures from earlier attempts before installing the
-- definitive contract.
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
  is_admin boolean;
  response jsonb;
BEGIN
  IF target_date IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22004',
      MESSAGE = 'Target date is required';
  END IF;

  IF requesting_user_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '28000',
      MESSAGE = 'Authentication required';
  END IF;

  -- Do not depend on the historically inconsistent has_capability helper.
  -- Authorize directly against the canonical capability assignment table.
  SELECT EXISTS (
    SELECT 1
    FROM public.user_capabilities uc
    WHERE uc.user_id = requesting_user_id
      AND uc.capability_code = 'admin'
  )
  INTO is_admin;

  IF NOT is_admin THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'Administrator access required';
  END IF;

  WITH
  bounds AS (
    SELECT
      target_date::timestamp AT TIME ZONE 'Asia/Kolkata' AS starts_at,
      (target_date + 1)::timestamp AT TIME ZONE 'Asia/Kolkata' AS ends_at
  ),
  active_users AS (
    SELECT
      u.user_id,
      u.name
    FROM public.users u
    WHERE lower(COALESCE(u.is_active::text, 'false')) IN ('1', 'true', 't')
  ),
  capability_rollup AS (
    SELECT
      uc.user_id,
      array_agg(uc.capability_code ORDER BY uc.capability_code) AS capability_codes,
      string_agg(
        COALESCE(c.label, initcap(replace(uc.capability_code, '_', ' '))),
        ' · '
        ORDER BY uc.capability_code
      ) AS role_label
    FROM public.user_capabilities uc
    LEFT JOIN public.capabilities c
      ON c.code = uc.capability_code
    GROUP BY uc.user_id
  ),
  completed_task_events AS (
    -- Immutable completion transitions are the durable source for normal tasks.
    SELECT
      COALESCE(history.changed_by, task.assigned_to) AS user_id,
      history.changed_at AS completed_at
    FROM public.task_status_history history
    JOIN public.tasks task ON task.task_id = history.task_id
    CROSS JOIN bounds b
    WHERE history.new_status = 'Completed'
      AND COALESCE(history.changed_by, task.assigned_to) IS NOT NULL
      AND history.changed_at >= b.starts_at
      AND history.changed_at < b.ends_at

    UNION ALL

    -- Legacy tasks without a completion-history event still remain countable.
    SELECT
      task.assigned_to AS user_id,
      task.completed_at AS completed_at
    FROM public.tasks task
    CROSS JOIN bounds b
    WHERE task.status = 'Completed'
      AND task.assigned_to IS NOT NULL
      AND task.completed_at IS NOT NULL
      AND task.completed_at >= b.starts_at
      AND task.completed_at < b.ends_at
      AND NOT EXISTS (
        SELECT 1
        FROM public.task_status_history history
        WHERE history.task_id = task.task_id
          AND history.new_status = 'Completed'
      )

    UNION ALL

    -- Spreadsheet-allocated targets are also real assigned tasks in My Day.
    SELECT
      target.assigned_to_user_id AS user_id,
      target.completed_at AS completed_at
    FROM public.allocated_targets target
    CROSS JOIN bounds b
    WHERE target.is_completed = true
      AND target.assigned_to_user_id IS NOT NULL
      AND target.completed_at IS NOT NULL
      AND target.completed_at >= b.starts_at
      AND target.completed_at < b.ends_at
  ),
  completed_tasks AS (
    SELECT
      event.user_id,
      count(*)::integer AS total,
      max(event.completed_at) AS latest_at
    FROM completed_task_events event
    GROUP BY event.user_id
  ),
  logged_calls AS (
    SELECT
      c.user_id,
      count(*)::integer AS total,
      max(c.timestamp) AS latest_at
    FROM public.call_logs c
    CROSS JOIN bounds b
    WHERE c.user_id IS NOT NULL
      AND c.timestamp >= b.starts_at
      AND c.timestamp < b.ends_at
      -- Pipeline gate notes were historically stored as synthetic call logs.
      -- They are not real calls and must never inflate performance counts.
      AND position('→' IN COALESCE(c.outcome, '')) = 0
    GROUP BY c.user_id
  ),
  resolved_queries AS (
    SELECT
      COALESCE(q.resolved_by, q.assigned_to) AS user_id,
      count(*)::integer AS total,
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
      count(*)::integer AS total,
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
      COALESCE(lc.total, 0)
        + COALESCE(rq.total, 0)
        + COALESCE(cm.total, 0)
        + COALESCE(ct.total, 0) AS total_completed_work,
      CASE
        WHEN lc.latest_at IS NULL
          AND rq.latest_at IS NULL
          AND cm.latest_at IS NULL
          AND ct.latest_at IS NULL
        THEN NULL
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
    'rows', COALESCE(
      (
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
          )
          ORDER BY r.total_completed_work DESC, lower(r.name), r.user_id
        )
        FROM report_rows r
      ),
      '[]'::jsonb
    ),
    'totals', jsonb_build_object(
      'team_members', (SELECT count(*)::integer FROM report_rows),
      'calls_made', COALESCE((SELECT sum(calls_made)::integer FROM report_rows), 0),
      'queries_handled', COALESCE((SELECT sum(queries_handled)::integer FROM report_rows), 0),
      'mappings_completed', COALESCE((SELECT sum(mappings_completed)::integer FROM report_rows), 0),
      'tasks_completed', COALESCE((SELECT sum(tasks_completed)::integer FROM report_rows), 0),
      'total_completed_work', COALESCE((SELECT sum(total_completed_work)::integer FROM report_rows), 0)
    )
  )
  INTO response;

  RETURN response;
END;
$$;

REVOKE ALL ON FUNCTION public.get_team_kpi_daily(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_team_kpi_daily(date) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_team_kpi_daily(date) TO authenticated;

COMMENT ON FUNCTION public.get_team_kpi_daily(date) IS
  'Admin-only, server-authoritative daily Team KPI aggregation using Asia/Kolkata business-day boundaries.';


COMMIT;

DO \$\$
BEGIN
  RAISE NOTICE 'APPLY SCRIPT COMPLETED SUCCESSFULLY.';
END;
\$\$;
