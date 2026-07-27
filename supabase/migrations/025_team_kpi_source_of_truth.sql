-- 025_team_kpi_source_of_truth.sql

-- Drop the old kpi_daily_snapshot related functions and policies since we are moving away from it
DROP FUNCTION IF EXISTS public.compute_daily_kpi_snapshot;

-- The new real-time aggregator function
-- Takes target_date (YYYY-MM-DD) and aggregates performance data in 'Asia/Kolkata' timezone boundaries
CREATE OR REPLACE FUNCTION public.get_team_kpi_daily(target_date text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    result json;
    local_start timestamp with time zone;
    local_end timestamp with time zone;
    req_uid uuid;
    req_is_admin boolean;
BEGIN
    -- Authorization check: caller must be authenticated
    req_uid := auth.uid();
    IF req_uid IS NULL THEN
        RAISE EXCEPTION 'Unauthorized';
    END IF;

    -- Check if user is admin
    req_is_admin := public.has_capability('admin');

    -- Define day boundaries in IST
    local_start := (target_date || ' 00:00:00')::timestamp at time zone 'Asia/Kolkata';
    local_end := (target_date || ' 23:59:59.999')::timestamp at time zone 'Asia/Kolkata';

    WITH user_data AS (
        SELECT 
            u.user_id,
            u.name,
            u.role,
            -- Tasks assigned and completed
            (SELECT COUNT(*) FROM public.tasks t WHERE t.assigned_to = u.user_id AND t.due_date = target_date::date) AS tasks_assigned,
            (SELECT COUNT(*) FROM public.tasks t WHERE t.assigned_to = u.user_id AND t.due_date = target_date::date AND t.status = 'Completed') AS tasks_completed,
            -- Calls made
            (SELECT COUNT(*) FROM public.call_logs c WHERE c.user_id = u.user_id AND c.timestamp >= local_start AND c.timestamp <= local_end) AS calls_made,
            -- Mappings completed
            (SELECT COUNT(*) FROM public.mapping_requests m WHERE m.mapped_by = u.user_id AND m.status = 'Completed' AND m.completed_at >= local_start AND m.completed_at <= local_end) AS mappings_completed,
            -- Queries handled (resolved)
            (SELECT COUNT(*) FROM public.client_queries q WHERE q.resolved_by = u.user_id AND q.problem_status = 'Resolved' AND q.resolved_at >= local_start AND q.resolved_at <= local_end) AS queries_handled,
            -- Leads converted
            (SELECT COUNT(*) FROM public.leads l WHERE l.assigned_to = u.user_id AND l.status IN ('Registration','Installation','Payment') AND (l.created_at >= local_start AND l.created_at <= local_end OR l.onboarded_at >= local_start AND l.onboarded_at <= local_end)) AS leads_converted,
            -- Attendance Status
            COALESCE(
                (SELECT CASE 
                    WHEN r.status = 'Approved' THEN 'Present'
                    ELSE NULL
                END FROM public.attendance_regularization_requests r WHERE r.user_id = u.user_id AND r.date = target_date::date LIMIT 1),
                (SELECT CASE 
                    WHEN a.clock_in IS NOT NULL THEN 'Present'
                    ELSE 'Absent'
                END FROM public.attendance a WHERE a.user_id = u.user_id AND a.date = target_date::date LIMIT 1),
                'Absent'
            ) AS attendance_status,
            -- Latest activity time
            GREATEST(
                (SELECT MAX(c.timestamp) FROM public.call_logs c WHERE c.user_id = u.user_id AND c.timestamp >= local_start AND c.timestamp <= local_end),
                (SELECT MAX(t.completed_at) FROM public.tasks t WHERE t.assigned_to = u.user_id AND t.status = 'Completed' AND t.completed_at >= local_start AND t.completed_at <= local_end),
                (SELECT MAX(m.completed_at) FROM public.mapping_requests m WHERE m.mapped_by = u.user_id AND m.status = 'Completed' AND m.completed_at >= local_start AND m.completed_at <= local_end),
                (SELECT MAX(q.resolved_at) FROM public.client_queries q WHERE q.resolved_by = u.user_id AND q.problem_status = 'Resolved' AND q.resolved_at >= local_start AND q.resolved_at <= local_end)
            ) AS latest_activity_time
        FROM public.users u
        WHERE (req_is_admin = true OR u.user_id = req_uid OR u.manager_id = req_uid)
    )
    SELECT json_agg(
        json_build_object(
            'user_id', user_id,
            'name', name,
            'role', role,
            'tasks_assigned', tasks_assigned,
            'tasks_completed', tasks_completed,
            'completion_rate', CASE WHEN tasks_assigned > 0 THEN round((tasks_completed::numeric / tasks_assigned::numeric) * 100) ELSE 0 END,
            'calls_made', calls_made,
            'mappings_completed', mappings_completed,
            'queries_handled', queries_handled,
            'leads_converted', leads_converted,
            'total_completed_work', (calls_made + tasks_completed + mappings_completed + queries_handled),
            'attendance_status', attendance_status,
            'latest_activity_time', latest_activity_time
        )
    )
    INTO result
    FROM user_data;
    
    RETURN COALESCE(result, '[]');
END;
$$;
