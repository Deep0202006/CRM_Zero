-- Weekly Digest Migration
-- 1. Create the digest table
CREATE TABLE IF NOT EXISTS public.weekly_digest_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    week_start DATE NOT NULL,
    generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    data JSONB NOT NULL,
    UNIQUE(week_start)
);

-- RLS: Only admins/managers can view digests
ALTER TABLE public.weekly_digest_log ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS "Allow managers and admins to view digests" ON public.weekly_digest_log;
CREATE POLICY "Allow managers and admins to view digests" 
ON public.weekly_digest_log FOR SELECT 
USING (
    public.has_capability('admin') OR public.has_capability('manager')
);

-- 2. Create the generation function
CREATE OR REPLACE FUNCTION public.generate_weekly_digest()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_week_start DATE;
    v_data JSONB;
BEGIN
    -- Determine the start of the current week (Monday)
    v_week_start := date_trunc('week', current_date)::DATE;
    
    -- Generate the JSON structure. This simplifies what managers see.
    -- We aggregate stuck leads, task completions, and upcoming renewals.
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
    INSERT INTO public.weekly_digest_log (week_start, data)
    VALUES (v_week_start, v_data)
    ON CONFLICT (week_start) DO UPDATE SET
        data = EXCLUDED.data,
        generated_at = NOW();
END;
$$;

-- 3. Schedule via pg_cron (runs every Monday at 1:00 AM)
-- Note: pg_cron requires the pg_cron extension to be enabled in Supabase.
-- Uncomment and run the following if pg_cron is enabled:
-- SELECT cron.schedule('generate_weekly_digest_job', '0 1 * * 1', 'SELECT public.generate_weekly_digest();');
