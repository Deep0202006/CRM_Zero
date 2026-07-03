-- =====================================================================
-- Nexus CRM — Consolidated Schema Addendum
-- File: supabase/migrations/002_addendum.sql
-- Run AFTER 001_base_schema.sql, top-to-bottom in the Supabase SQL editor.
-- Nothing in this file drops or renames any existing table or column.
-- =====================================================================

-- =====================================================================
-- PART 1A — Reporting hierarchy
-- =====================================================================
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS manager_id uuid REFERENCES public.users(user_id);

-- =====================================================================
-- PART 1B — Task templates
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.task_templates (
    template_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    description text,
    applies_to_capability text REFERENCES public.capabilities(code) NOT NULL,
    default_priority text NOT NULL CHECK (default_priority IN ('High','Medium','Low')),
    recurrence text NOT NULL DEFAULT 'daily',
    is_active integer NOT NULL DEFAULT 1,
    created_by uuid REFERENCES public.users(user_id),
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- =====================================================================
-- PART 1C — Task instances
-- =====================================================================
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_status_enum') THEN
        CREATE TYPE task_status_enum AS ENUM ('Pending','In Progress','Completed','Missed');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_priority_enum') THEN
        CREATE TYPE task_priority_enum AS ENUM ('High','Medium','Low');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'task_source_enum') THEN
        CREATE TYPE task_source_enum AS ENUM ('template','manual');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.tasks (
    task_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    assigned_to uuid REFERENCES public.users(user_id) NOT NULL,
    assigned_by uuid REFERENCES public.users(user_id),
    title text NOT NULL,
    description text,
    priority task_priority_enum NOT NULL,
    status task_status_enum NOT NULL DEFAULT 'Pending',
    source task_source_enum NOT NULL DEFAULT 'template',
    template_id uuid REFERENCES public.task_templates(template_id),
    related_lead_id uuid REFERENCES public.leads(lead_id),
    due_date date NOT NULL DEFAULT CURRENT_DATE,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    proof_note text,
    proof_photo_url text,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT unique_template_per_user_per_day UNIQUE (assigned_to, template_id, due_date)
);

CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to_due_date ON public.tasks(assigned_to, due_date);

-- =====================================================================
-- PART 1D — Task status history
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.task_status_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id uuid REFERENCES public.tasks(task_id) ON DELETE CASCADE NOT NULL,
    changed_by uuid REFERENCES public.users(user_id),
    old_status text,
    new_status text NOT NULL,
    changed_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- =====================================================================
-- PART 1E — KPI daily snapshot
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.kpi_daily_snapshot (
    snapshot_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES public.users(user_id) NOT NULL,
    date date NOT NULL,
    tasks_assigned int NOT NULL DEFAULT 0,
    tasks_completed int NOT NULL DEFAULT 0,
    tasks_completed_on_time int NOT NULL DEFAULT 0,
    tasks_missed int NOT NULL DEFAULT 0,
    completion_rate numeric GENERATED ALWAYS AS (
        CASE WHEN tasks_assigned = 0 THEN 0
        ELSE round((tasks_completed::numeric / tasks_assigned::numeric) * 100, 1) END
    ) STORED,
    avg_completion_minutes numeric,
    attendance_status text,
    clock_in_time time,
    leads_touched int NOT NULL DEFAULT 0,
    leads_converted int NOT NULL DEFAULT 0,
    calls_logged int NOT NULL DEFAULT 0,
    tickets_resolved int NOT NULL DEFAULT 0,
    mapping_requests_resolved int NOT NULL DEFAULT 0,
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT unique_user_date UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_kpi_user_date ON public.kpi_daily_snapshot(user_id, date);

-- =====================================================================
-- PART 1F — RLS for new tables
-- =====================================================================
ALTER TABLE public.task_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_daily_snapshot ENABLE ROW LEVEL SECURITY;

CREATE POLICY task_templates_read ON public.task_templates
    FOR SELECT USING (true);
CREATE POLICY task_templates_write ON public.task_templates
    FOR ALL USING (public.check_user_capability(auth.uid(), 'admin'));

CREATE POLICY tasks_read ON public.tasks
    FOR SELECT USING (
        assigned_to = auth.uid() OR
        public.check_user_capability(auth.uid(), 'admin')
    );
CREATE POLICY tasks_write ON public.tasks
    FOR ALL USING (
        assigned_to = auth.uid() OR
        public.check_user_capability(auth.uid(), 'admin')
    );

CREATE POLICY task_history_read ON public.task_status_history
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.tasks t
            WHERE t.task_id = task_status_history.task_id
            AND (t.assigned_to = auth.uid() OR public.check_user_capability(auth.uid(), 'admin'))
        )
    );
CREATE POLICY task_history_write ON public.task_status_history
    FOR INSERT WITH CHECK (true);

CREATE POLICY kpi_read ON public.kpi_daily_snapshot
    FOR SELECT USING (
        user_id = auth.uid() OR
        public.check_user_capability(auth.uid(), 'admin') OR
        EXISTS (SELECT 1 FROM public.users u WHERE u.user_id = kpi_daily_snapshot.user_id AND u.manager_id = auth.uid())
    );
-- KPI rows are written only by the nightly server-side job (service role)
CREATE POLICY kpi_write_service_only ON public.kpi_daily_snapshot
    FOR ALL USING (false) WITH CHECK (false);

-- =====================================================================
-- PART 1G — Seed task templates (21 rows)
-- =====================================================================
INSERT INTO public.task_templates (title, description, applies_to_capability, default_priority, recurrence) VALUES
('Call 5 new distributor leads','Contact leads currently in New status and move them to Contacted.','dist_onboarding','High','daily'),
('Follow up Interested-stage distributors','Push distributor leads sitting in Interested toward Registration.','dist_onboarding','Medium','daily'),
('Update yesterday''s lead statuses','Ensure every distributor lead contacted yesterday has a current status.','dist_onboarding','Low','daily'),
('Call 5 new retailer leads','Contact leads currently in New status and move them to Contacted.','ret_onboarding','High','daily'),
('Follow up Interested-stage retailers','Push retailer leads sitting in Interested toward Registration.','ret_onboarding','Medium','daily'),
('Update yesterday''s lead statuses','Ensure every retailer lead contacted yesterday has a current status.','ret_onboarding','Low','daily'),
('Resolve open distributor tickets','Clear all Open-status distributor client queries.','dist_support','High','daily'),
('Check in with 3 active distributor accounts','Proactive call to converted distributors to catch issues early.','dist_support','Medium','daily'),
('Review pending distributor mapping requests','Verify and resolve mapping requests tied to distributor accounts.','dist_support','Medium','daily'),
('Resolve open retailer tickets','Clear all Open-status retailer client queries.','ret_support','High','daily'),
('Check in with 3 active retailer accounts','Proactive call to converted retailers to catch issues early.','ret_support','Medium','daily'),
('Review pending retailer mapping requests','Verify and resolve mapping requests tied to retailer accounts.','ret_support','Medium','daily'),
('Visit 4 distributor sites','On-site visits to registered distributor locations.','field_dist','High','daily'),
('Verify kit/signage installation','Confirm physical setup matches the installation record.','field_dist','Medium','daily'),
('Submit visit feedback form','Log outcome notes for every site visited today.','field_dist','Low','daily'),
('Visit 4 retailer shops','On-site visits to registered retailer locations.','field_ret','High','daily'),
('Confirm billing software usage','Check the shop is actively using the mapping/billing software correctly.','field_ret','Medium','daily'),
('Submit visit feedback form','Log outcome notes for every shop visited today.','field_ret','Low','daily'),
('Triage new bug tickets','Review internal_tickets created since last login and assign priority.','tech_support','High','daily'),
('Resolve High priority tickets','Work through all High priority open tickets first.','tech_support','High','daily'),
('Clear ticket backlog updates','Add a status update to every ticket untouched for 48+ hours.','tech_support','Medium','daily')
ON CONFLICT DO NOTHING;

-- =====================================================================
-- PART 2 — Pipeline optimization
-- =====================================================================
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS stage_entered_at timestamp with time zone
    NOT NULL DEFAULT timezone('utc'::text, now());

CREATE OR REPLACE FUNCTION public.track_lead_stage_change()
RETURNS trigger AS $$
BEGIN
    IF new.status IS DISTINCT FROM old.status THEN
        new.stage_entered_at = timezone('utc'::text, now());
    END IF;
    RETURN new;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lead_stage_change ON public.leads;
CREATE TRIGGER trg_lead_stage_change
BEFORE UPDATE ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.track_lead_stage_change();

-- Auto-task on stage transition
CREATE OR REPLACE FUNCTION public.create_followup_task_on_stage_change()
RETURNS trigger AS $$
DECLARE
    task_priority task_priority_enum;
    task_title text;
BEGIN
    IF new.status IS DISTINCT FROM old.status AND new.assigned_to IS NOT NULL THEN
        task_priority := CASE new.status
            WHEN 'Contacted'    THEN 'Medium'
            WHEN 'Interested'   THEN 'High'
            WHEN 'Registration' THEN 'High'
            WHEN 'Payment'      THEN 'High'
            ELSE 'Low'
        END;
        task_title := 'Follow up: ' || new.business_name || ' (' || new.status || ')';
        INSERT INTO public.tasks (
            assigned_to, assigned_by, title, description, priority,
            source, related_lead_id, due_date
        ) VALUES (
            new.assigned_to, NULL, task_title,
            'Lead moved to ' || new.status || '. Follow up before it goes stale.',
            task_priority, 'manual', new.lead_id, CURRENT_DATE + 1
        ) ON CONFLICT DO NOTHING;
    END IF;
    RETURN new;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_lead_followup_task ON public.leads;
CREATE TRIGGER trg_lead_followup_task
AFTER UPDATE ON public.leads
FOR EACH ROW EXECUTE FUNCTION public.create_followup_task_on_stage_change();

-- Stale lead view
CREATE OR REPLACE VIEW public.stale_leads AS
SELECT lead_id, business_name, segment_type, status, assigned_to, stage_entered_at,
    EXTRACT(day FROM (now() - stage_entered_at)) AS days_in_stage
FROM public.leads
WHERE status NOT IN ('Installation','Not Interested')
AND stage_entered_at < now() - INTERVAL '48 hours';

-- =====================================================================
-- PART 3 — Support & Mapping bridge optimization
-- =====================================================================
CREATE OR REPLACE FUNCTION public.create_task_on_new_query()
RETURNS trigger AS $$
BEGIN
    IF new.assigned_to IS NOT NULL THEN
        INSERT INTO public.tasks (
            assigned_to, title, description, priority, source, due_date
        ) VALUES (
            new.assigned_to,
            'Resolve client query',
            new.client_problem,
            'High', 'manual', CURRENT_DATE
        );
    END IF;
    RETURN new;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_query_task ON public.client_queries;
CREATE TRIGGER trg_query_task
AFTER INSERT ON public.client_queries
FOR EACH ROW EXECUTE FUNCTION public.create_task_on_new_query();

CREATE OR REPLACE VIEW public.overdue_queries AS
SELECT query_id, lead_id, client_problem, assigned_to, created_at,
    EXTRACT(hour FROM (now() - created_at)) AS hours_open
FROM public.client_queries
WHERE problem_status != 'Resolved'
AND created_at < now() - INTERVAL '24 hours';

-- =====================================================================
-- PART 4 — Attendance optimization
-- =====================================================================
ALTER TABLE public.attendance ALTER COLUMN selfie_url DROP NOT NULL;
ALTER TABLE public.attendance ALTER COLUMN latitude DROP NOT NULL;
ALTER TABLE public.attendance ALTER COLUMN longitude DROP NOT NULL;

-- Configurable shift start (replaces hardcoded 10:00 in KPI function)
CREATE TABLE IF NOT EXISTS public.attendance_shift_config (
    config_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    shift_start time NOT NULL DEFAULT '10:00',
    grace_minutes int NOT NULL DEFAULT 15,
    updated_by uuid REFERENCES public.users(user_id),
    updated_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);
INSERT INTO public.attendance_shift_config (shift_start, grace_minutes)
    VALUES ('10:00', 15)
    ON CONFLICT DO NOTHING;

-- Regularization requests
CREATE TABLE IF NOT EXISTS public.attendance_regularization_requests (
    request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES public.users(user_id) NOT NULL,
    date date NOT NULL,
    reason text NOT NULL,
    status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Approved','Rejected')),
    reviewed_by uuid REFERENCES public.users(user_id),
    created_at timestamp with time zone DEFAULT timezone('utc'::text, now())
);
ALTER TABLE public.attendance_regularization_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY regularization_own_read ON public.attendance_regularization_requests
    FOR SELECT USING (user_id = auth.uid() OR public.check_user_capability(auth.uid(), 'admin'));
CREATE POLICY regularization_own_insert ON public.attendance_regularization_requests
    FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY regularization_admin_update ON public.attendance_regularization_requests
    FOR UPDATE USING (public.check_user_capability(auth.uid(), 'admin'));

-- =====================================================================
-- PART 1F (cont.) — Nightly KPI computation function
-- Schedule with pg_cron:
--   SELECT cron.schedule('nightly-kpi','55 23 * * *',
--     $$ SELECT public.compute_daily_kpi_snapshot(current_date); $$);
-- =====================================================================
CREATE OR REPLACE FUNCTION public.compute_daily_kpi_snapshot(target_date date)
RETURNS void SECURITY DEFINER AS $$
DECLARE
    late_cutoff time;
BEGIN
    -- Read configurable shift start + grace
    SELECT shift_start + (grace_minutes || ' minutes')::interval
    INTO late_cutoff
    FROM public.attendance_shift_config
    LIMIT 1;

    IF late_cutoff IS NULL THEN late_cutoff := '10:15'; END IF;

    INSERT INTO public.kpi_daily_snapshot (
        user_id, date, tasks_assigned, tasks_completed, tasks_completed_on_time,
        tasks_missed, avg_completion_minutes, attendance_status, clock_in_time,
        leads_touched, leads_converted, calls_logged, tickets_resolved,
        mapping_requests_resolved
    )
    SELECT
        u.user_id,
        target_date,
        COALESCE(t.tasks_assigned, 0),
        COALESCE(t.tasks_completed, 0),
        COALESCE(t.tasks_completed_on_time, 0),
        COALESCE(t.tasks_assigned, 0) - COALESCE(t.tasks_completed, 0),
        t.avg_completion_minutes,
        CASE
            -- Check if approved regularization exists — treat as Present
            WHEN EXISTS (
                SELECT 1 FROM public.attendance_regularization_requests r
                WHERE r.user_id = u.user_id AND r.date = target_date AND r.status = 'Approved'
            ) THEN 'Present'
            WHEN a.clock_in IS NULL THEN 'Absent'
            WHEN a.clock_in::time > late_cutoff THEN 'Late'
            ELSE 'Present'
        END,
        a.clock_in::time,
        COALESCE(l.leads_touched, 0),
        COALESCE(l.leads_converted, 0),
        COALESCE(c.calls_logged, 0),
        COALESCE(ti.tickets_resolved, 0),
        COALESCE(mr.mapping_requests_resolved, 0)
    FROM public.users u
    LEFT JOIN (
        SELECT assigned_to,
            count(*) AS tasks_assigned,
            count(*) FILTER (WHERE status = 'Completed') AS tasks_completed,
            count(*) FILTER (WHERE status = 'Completed' AND completed_at::date <= due_date) AS tasks_completed_on_time,
            avg(EXTRACT(epoch FROM (completed_at - started_at)) / 60)
                FILTER (WHERE completed_at IS NOT NULL AND started_at IS NOT NULL) AS avg_completion_minutes
        FROM public.tasks
        WHERE due_date = target_date
        GROUP BY assigned_to
    ) t ON t.assigned_to = u.user_id
    LEFT JOIN public.attendance a ON a.user_id = u.user_id AND a.date = target_date
    LEFT JOIN (
        SELECT assigned_to AS user_id,
            count(*) AS leads_touched,
            count(*) FILTER (WHERE status IN ('Registration','Installation','Payment')) AS leads_converted
        FROM public.leads
        WHERE created_at::date = target_date OR onboarded_at::date = target_date
        GROUP BY assigned_to
    ) l ON l.user_id = u.user_id
    LEFT JOIN (
        SELECT user_id, count(*) AS calls_logged
        FROM public.call_logs
        WHERE timestamp::date = target_date
        GROUP BY user_id
    ) c ON c.user_id = u.user_id
    LEFT JOIN (
        SELECT assigned_to AS user_id, count(*) AS tickets_resolved
        FROM public.internal_tickets
        WHERE resolved_at::date = target_date
        GROUP BY assigned_to
    ) ti ON ti.user_id = u.user_id
    LEFT JOIN (
        SELECT mapped_by AS user_id, count(*) AS mapping_requests_resolved
        FROM public.mappings
        WHERE created_at::date = target_date
        GROUP BY mapped_by
    ) mr ON mr.user_id = u.user_id
    ON CONFLICT (user_id, date) DO UPDATE SET
        tasks_assigned = excluded.tasks_assigned,
        tasks_completed = excluded.tasks_completed,
        tasks_completed_on_time = excluded.tasks_completed_on_time,
        tasks_missed = excluded.tasks_missed,
        avg_completion_minutes = excluded.avg_completion_minutes,
        attendance_status = excluded.attendance_status,
        clock_in_time = excluded.clock_in_time,
        leads_touched = excluded.leads_touched,
        leads_converted = excluded.leads_converted,
        calls_logged = excluded.calls_logged,
        tickets_resolved = excluded.tickets_resolved,
        mapping_requests_resolved = excluded.mapping_requests_resolved;

    -- Mark overdue tasks as Missed
    UPDATE public.tasks
    SET status = 'Missed'
    WHERE due_date < target_date AND status IN ('Pending','In Progress');
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- Schedule nightly KPI at 23:55 (requires pg_cron extension)
-- Uncomment after enabling pg_cron in Supabase dashboard:
-- =====================================================================
-- SELECT cron.schedule('nightly-kpi', '55 23 * * *',
--   $$ SELECT public.compute_daily_kpi_snapshot(current_date); $$);

-- =====================================================================
-- VERIFICATION QUERIES (run individually to confirm)
-- =====================================================================
-- SELECT COUNT(*) FROM public.task_templates; -- should return 21
-- SELECT COUNT(*) FROM public.tasks;
-- SELECT * FROM public.stale_leads LIMIT 10;
-- SELECT * FROM public.overdue_queries LIMIT 10;
-- SELECT * FROM public.attendance_shift_config;
