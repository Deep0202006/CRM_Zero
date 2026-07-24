-- =====================================================================
-- PATCH 011: Analytics & KPI Hardening
-- =====================================================================

-- 1. Fix Mapping Request KPI Trigger (Use UPSERT)
CREATE OR REPLACE FUNCTION update_kpi_mapping_request()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'Completed' AND OLD.status != 'Completed' THEN
    INSERT INTO public.kpi_daily_snapshot (user_id, date, mapping_requests_resolved)
    VALUES (NEW.mapped_by, CURRENT_DATE, 1)
    ON CONFLICT (user_id, date) DO UPDATE 
    SET mapping_requests_resolved = kpi_daily_snapshot.mapping_requests_resolved + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Create Client Queries KPI Trigger (Increment tickets_resolved)
CREATE OR REPLACE FUNCTION update_kpi_client_queries()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.problem_status = 'Resolved' AND OLD.problem_status != 'Resolved' THEN
    INSERT INTO public.kpi_daily_snapshot (user_id, date, tickets_resolved)
    VALUES (NEW.resolved_by, CURRENT_DATE, 1)
    ON CONFLICT (user_id, date) DO UPDATE 
    SET tickets_resolved = kpi_daily_snapshot.tickets_resolved + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_client_query_resolved ON public.client_queries;
CREATE TRIGGER on_client_query_resolved
AFTER UPDATE ON public.client_queries
FOR EACH ROW
EXECUTE FUNCTION update_kpi_client_queries();

-- 3. Restore and harden the truncated generate_weekly_digest() function
CREATE OR REPLACE FUNCTION public.generate_weekly_digest()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_week_start DATE;
    v_data JSONB;
BEGIN
    -- Determine the start of the current week (Monday). Ensure UTC.
    v_week_start := date_trunc('week', timezone('utc'::text, now()))::DATE;
    
    -- Generate the JSON structure.
    WITH stuck_leads AS (
        SELECT jsonb_agg(
            jsonb_build_object(
                'id', lead_id,
                'name', business_name,
                'status', status,
                'days_in_stage', current_date - COALESCE(stage_entered_at, created_at)::date,
                'assigned_to', assigned_to
            )
        ) as leads
        FROM public.leads
        WHERE current_date - COALESCE(stage_entered_at, created_at)::date > 14
        AND status NOT IN ('Payment', 'Installation')
    ),
    task_performance AS (
        SELECT jsonb_agg(
            jsonb_build_object(
                'assigned_to', assigned_to,
                'completed_count', count(*) FILTER (WHERE status = 'Completed'),
                'total_count', count(*)
            )
        ) as tasks
        FROM public.tasks
        WHERE created_at >= v_week_start - interval '7 days'
        GROUP BY assigned_to
    ),
    upcoming_renewals AS (
        SELECT jsonb_agg(
            jsonb_build_object(
                'id', lead_id,
                'name', business_name,
                'renewal_date', renewal_date
            )
        ) as renewals
        FROM public.leads
        WHERE status = 'Payment' 
        AND renewal_date >= current_date
        AND renewal_date <= current_date + interval '30 days'
    )
    SELECT jsonb_build_object(
        'stuck_leads', COALESCE((SELECT leads FROM stuck_leads), '[]'::jsonb),
        'task_performance', COALESCE((SELECT tasks FROM task_performance), '[]'::jsonb),
        'upcoming_renewals', COALESCE((SELECT renewals FROM upcoming_renewals), '[]'::jsonb)
    ) INTO v_data;
    
    -- Upsert the digest for the current week
    INSERT INTO public.weekly_digest_log (week_start, data, generated_at)
    VALUES (v_week_start, v_data, timezone('utc'::text, now()))
    ON CONFLICT (week_start) DO UPDATE SET
        data = EXCLUDED.data,
        generated_at = EXCLUDED.generated_at;
END;
$$;
