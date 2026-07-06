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


DROP POLICY IF EXISTS "task_templates_read" ON public.task_templates;
CREATE POLICY task_templates_read ON public.task_templates
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "task_templates_write" ON public.task_templates;
CREATE POLICY task_templates_write ON public.task_templates
    FOR ALL USING (public.has_capability('admin'));


DROP POLICY IF EXISTS "tasks_read" ON public.tasks;
CREATE POLICY tasks_read ON public.tasks
    FOR SELECT USING (
        assigned_to = auth.uid() OR
        public.has_capability('admin')
    );

DROP POLICY IF EXISTS "tasks_write" ON public.tasks;
CREATE POLICY tasks_write ON public.tasks
    FOR ALL USING (
        assigned_to = auth.uid() OR
        public.has_capability('admin')
    );


DROP POLICY IF EXISTS "task_history_read" ON public.task_status_history;
CREATE POLICY task_history_read ON public.task_status_history
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.tasks t
            WHERE t.task_id = task_status_history.task_id
            AND (t.assigned_to = auth.uid() OR public.has_capability('admin'))
        )
    );

DROP POLICY IF EXISTS "task_history_write" ON public.task_status_history;
CREATE POLICY task_history_write ON public.task_status_history
    FOR INSERT WITH CHECK (true);


DROP POLICY IF EXISTS "kpi_read" ON public.kpi_daily_snapshot;
CREATE POLICY kpi_read ON public.kpi_daily_snapshot
    FOR SELECT USING (
        user_id = auth.uid() OR
        public.has_capability('admin') OR
        EXISTS (SELECT 1 FROM public.users u WHERE u.user_id = kpi_daily_snapshot.user_id AND u.manager_id = auth.uid())
    );
-- KPI rows are written only by the nightly server-side job (service role)

DROP POLICY IF EXISTS "kpi_write_service_only" ON public.kpi_daily_snapshot;
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


DROP POLICY IF EXISTS "regularization_own_read" ON public.attendance_regularization_requests;
CREATE POLICY regularization_own_read ON public.attendance_regularization_requests
    FOR SELECT USING (user_id = auth.uid() OR public.has_capability('admin'));

DROP POLICY IF EXISTS "regularization_own_insert" ON public.attendance_regularization_requests;
CREATE POLICY regularization_own_insert ON public.attendance_regularization_requests
    FOR INSERT WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "regularization_admin_update" ON public.attendance_regularization_requests;
CREATE POLICY regularization_admin_update ON public.attendance_regularization_requests
    FOR UPDATE USING (public.has_capability('admin'));

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
-- =====================================================================
-- A. Lead source — required at creation, feeds channel-performance KPIs
-- =====================================================================
alter table public.leads add column if not exists lead_source text
    check (lead_source in ('Referral','Cold Call','Inbound Inquiry','Exhibition/Event','Field Visit','Other'));

alter table public.leads add column if not exists area text;

-- Re-engagement date for lost leads — a "Not Interested" lead is not dead,
-- it's dormant. This is what brings it back instead of losing it forever.
alter table public.leads add column if not exists re_engage_after date;

-- =====================================================================
-- B. Structured call outcomes — extends the existing call_logs table.
-- One tap instead of a typed note, and it's now queryable for KPIs.
-- =====================================================================
alter table public.call_logs add column if not exists outcome text
    check (outcome in ('No Answer','Call Back Later','Interested','Not Interested','Switched Off','Wrong Number', 'Contacted'));
alter table public.call_logs add column if not exists next_call_at timestamp with time zone;

-- =====================================================================
-- C. Registration checklist — the single biggest cause of deals stalling.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.lead_registration_checklist (
    checklist_id uuid primary key default gen_random_uuid(),
    lead_id uuid references public.leads(lead_id) unique not null,
    gst_certificate_uploaded boolean not null default false,
    pan_uploaded boolean not null default false,
    bank_details_captured boolean not null default false,
    agreement_signed boolean not null default false,
    territory_assigned text,
    updated_at timestamp with time zone default timezone('utc'::text, now())
);

-- =====================================================================
-- D. Installation details — proof of work, not just a status flip.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.lead_installation_details (
    installation_id uuid primary key default gen_random_uuid(),
    lead_id uuid references public.leads(lead_id) unique not null,
    installed_by uuid references public.users(user_id),
    installation_date date,
    software_version text,
    staff_trained_count int default 0,
    issues_encountered text,
    proof_photo_url text,
    created_at timestamp with time zone default timezone('utc'::text, now())
);

-- =====================================================================
-- E. Payment details — clean structured record, not a note in a text box.
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.lead_payment_details (
    payment_id uuid primary key default gen_random_uuid(),
    lead_id uuid references public.leads(lead_id) unique not null,
    amount numeric not null,
    payment_mode text check (payment_mode in ('Bank Transfer','UPI','Cheque','Cash')),
    receipt_url text,
    collected_by uuid references public.users(user_id),
    paid_at timestamp with time zone default timezone('utc'::text, now())
);

-- =====================================================================
-- F. RLS — same visibility pattern as leads: own records + admin.
-- =====================================================================
alter table public.lead_registration_checklist enable row level security;
alter table public.lead_installation_details enable row level security;
alter table public.lead_payment_details enable row level security;


DROP POLICY IF EXISTS "checklist_access" ON public.lead_registration_checklist;
create policy checklist_access on public.lead_registration_checklist for all using (
    exists (select 1 from public.leads l where l.lead_id = lead_registration_checklist.lead_id
        and (l.assigned_to = auth.uid() or public.has_capability('admin')))
);

DROP POLICY IF EXISTS "installation_access" ON public.lead_installation_details;
create policy installation_access on public.lead_installation_details for all using (
    exists (select 1 from public.leads l where l.lead_id = lead_installation_details.lead_id
        and (l.assigned_to = auth.uid() or public.has_capability('admin')))
);

DROP POLICY IF EXISTS "payment_access" ON public.lead_payment_details;
create policy payment_access on public.lead_payment_details for all using (
    exists (select 1 from public.leads l where l.lead_id = lead_payment_details.lead_id
        and (l.assigned_to = auth.uid() or public.has_capability('admin')))
);

-- =====================================================================
-- G. Triggers
-- =====================================================================
create or replace function public.init_registration_checklist()
returns trigger as $$
begin
    if new.status = 'Registration' and old.status is distinct from 'Registration' then
        insert into public.lead_registration_checklist (lead_id)
        values (new.lead_id)
        on conflict (lead_id) do nothing;

        insert into public.tasks (assigned_to, title, description, priority, source, related_lead_id, due_date)
        values
        (new.assigned_to, 'Collect GST certificate: ' || new.business_name, 'Required for registration.', 'High', 'manual', new.lead_id, current_date + 1),
        (new.assigned_to, 'Collect PAN card: ' || new.business_name, 'Required for registration.', 'High', 'manual', new.lead_id, current_date + 1),
        (new.assigned_to, 'Capture bank details: ' || new.business_name, 'Required for payment setup.', 'Medium', 'manual', new.lead_id, current_date + 1),
        (new.assigned_to, 'Get agreement signed: ' || new.business_name, 'Final step before installation.', 'High', 'manual', new.lead_id, current_date + 2);
    end if;
    return new;
end;
$$ language plpgsql;

drop trigger if exists trg_init_registration_checklist on public.leads;
create trigger trg_init_registration_checklist
after update on public.leads
for each row execute function public.init_registration_checklist();

create or replace function public.surface_reengagement_leads()
returns void as $$
begin
    insert into public.tasks (assigned_to, title, description, priority, source, related_lead_id, due_date)
    select assigned_to, 'Re-engage: ' || business_name,
           'Marked not interested earlier — scheduled re-engagement window has arrived.',
           'Medium', 'manual', lead_id, current_date
    from public.leads
    where status = 'Not Interested' and re_engage_after = current_date and assigned_to is not null;
end;
$$ language plpgsql;

-- =====================================================================
-- H. Views
-- =====================================================================
create or replace view public.pipeline_funnel_summary as
select segment_type, status, count(*) as lead_count
from public.leads
group by segment_type, status;

create or replace view public.lead_source_performance as
select
    lead_source, segment_type,
    count(*) as total_leads,
    count(*) filter (where status = 'Payment') as converted,
    round(100.0 * count(*) filter (where status = 'Payment') / nullif(count(*),0), 1) as conversion_rate_pct
from public.leads
where lead_source is not null
group by lead_source, segment_type;

create or replace view public.avg_time_in_stage as
select
    status, segment_type,
    round(avg(extract(epoch from (now() - (case when stage_entered_at is null then created_at else stage_entered_at end))) / 86400), 1) as avg_days_in_current_stage
from public.leads
where status not in ('Payment', 'Not Interested')
group by status, segment_type;
-- Track the renewal clock on the lead itself
alter table public.leads add column if not exists renewal_date date;
alter table public.leads add column if not exists renewal_reminder_sent boolean not null default false;

-- The moment payment is recorded, set the renewal date exactly 1 year out
create or replace function public.set_renewal_date()
returns trigger as $$
begin
    update public.leads
    set renewal_date = (new.paid_at::date + interval '1 year')::date
    where lead_id = new.lead_id;
    return new;
end;
$$ language plpgsql;

drop trigger if exists trg_set_renewal_date on public.lead_payment_details;
create trigger trg_set_renewal_date
after insert on public.lead_payment_details
for each row execute function public.set_renewal_date();

-- Nightly job: 30-day-out heads-up, then the actual stage flip on the day itself
create or replace function public.process_renewals(target_date date)
returns void as $$
begin
    -- 30 days out: heads-up task, status stays "Payment" (still an active client)
    insert into public.tasks (assigned_to, title, description, priority, source, related_lead_id, due_date)
    select assigned_to, 'Renewal coming up: ' || business_name,
           'Renewal due on ' || renewal_date || '. Reach out to confirm continuation.',
           'Medium', 'manual', lead_id, target_date
    from public.leads
    where status = 'Payment'
      and renewal_date = target_date + interval '30 days'
      and renewal_reminder_sent = false;

    update public.leads set renewal_reminder_sent = true
    where status = 'Payment' and renewal_date = target_date + interval '30 days';

    -- On the exact renewal date: flip stage, force a High-priority task
    update public.leads
    set status = 'Renewal Due'
    where status = 'Payment' and renewal_date = target_date;

    insert into public.tasks (assigned_to, title, description, priority, source, related_lead_id, due_date)
    select assigned_to, 'Renewal due today: ' || business_name,
           'Contact the client today to renew.', 'High', 'manual', lead_id, target_date
    from public.leads
    where status = 'Renewal Due' and renewal_date = target_date;
end;
$$ language plpgsql;

-- 1.2 Registration checklist — corrected document set
alter table public.lead_registration_checklist drop column if exists bank_details_captured;
alter table public.lead_registration_checklist drop column if exists agreement_signed;
alter table public.lead_registration_checklist add column if not exists drug_licence_uploaded boolean not null default false;
alter table public.lead_registration_checklist add column if not exists bill_photo_uploaded boolean not null default false;

create or replace function public.init_registration_checklist()
returns trigger as $$
begin
    if new.status = 'Registration' and old.status is distinct from 'Registration' then
        insert into public.lead_registration_checklist (lead_id)
        values (new.lead_id)
        on conflict (lead_id) do nothing;

        insert into public.tasks (assigned_to, title, description, priority, source, related_lead_id, due_date)
        values
        (new.assigned_to, 'Collect GST certificate: ' || new.business_name, 'Required for registration.', 'High', 'manual', new.lead_id, current_date + 1),
        (new.assigned_to, 'Collect PAN card: ' || new.business_name, 'Required for registration.', 'High', 'manual', new.lead_id, current_date + 1),
        (new.assigned_to, 'Collect Drug Licence: ' || new.business_name, 'Required for registration.', 'High', 'manual', new.lead_id, current_date + 1),
        (new.assigned_to, 'Collect Bill Photo: ' || new.business_name, 'Required for registration.', 'Medium', 'manual', new.lead_id, current_date + 1);
    end if;
    return new;
end;
$$ language plpgsql;

-- 1.3 Universal rule: every scheduled follow-up becomes a My Day reminder
create or replace function public.create_task_from_call_followup()
returns trigger as $$
begin
    if new.next_call_at is not null then
        insert into public.tasks (assigned_to, title, description, priority, source, related_lead_id, due_date)
        select l.assigned_to, 'Call back: ' || l.business_name, 'Scheduled follow-up call.',
               'Medium', 'manual', l.lead_id, new.next_call_at::date
        from public.leads l where l.lead_id = new.lead_id;
    end if;
    return new;
end;
$$ language plpgsql;

drop trigger if exists trg_call_followup_task on public.call_logs;
create trigger trg_call_followup_task
after insert on public.call_logs
for each row execute function public.create_task_from_call_followup();

-- 1.4 Client support: require resolution notes on every closed ticket
alter table public.client_queries add column if not exists resolution_notes text;
alter table public.client_queries add column if not exists resolved_by uuid references public.users(user_id);
alter table public.client_queries add column if not exists resolved_at timestamp with time zone;

alter table public.internal_tickets add column if not exists resolution_notes text;

alter table public.client_queries add constraint resolution_notes_required
    check (problem_status != 'Resolved' or (resolution_notes is not null and length(trim(resolution_notes)) > 0));
-- Replace the old check constraint with the corrected option list
alter table public.leads drop constraint if exists leads_lead_source_check;
alter table public.leads add constraint leads_lead_source_check
    check (lead_source in ('Referral','Cold Call','Inbound Inquiry','Social Media','Field Visit','Other'));

-- New column to capture free text when "Other" is selected
alter table public.leads add column if not exists lead_source_other text;

-- Migrate existing "Exhibition/Event" leads to "Other"
update public.leads set lead_source = 'Other', lead_source_other = 'Exhibition/Event'
where lead_source = 'Exhibition/Event';
-- 006_mapping_requests.sql

-- Drop existing mapping_requests table (since this is just a log, dropping is acceptable as discussed)
DROP TABLE IF EXISTS public.mapping_requests CASCADE;

-- Recreate mapping_requests with new structure
CREATE TABLE IF NOT EXISTS public.mapping_requests (
  request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  distributor_lead_id UUID NOT NULL REFERENCES public.leads(lead_id) ON DELETE CASCADE,
  retailer_lead_id UUID NOT NULL REFERENCES public.leads(lead_id) ON DELETE CASCADE,
  mapped_by UUID REFERENCES public.users(user_id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('Pending', 'Completed')) DEFAULT 'Pending',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS
ALTER TABLE public.mapping_requests ENABLE ROW LEVEL SECURITY;

-- Create RLS Policies

DROP POLICY IF EXISTS "mapping_requests_access" ON public.mapping_requests;
CREATE POLICY mapping_requests_access ON public.mapping_requests
FOR ALL
USING (
  has_capability('ret_support') OR has_capability('dist_support') OR has_capability('admin')
);

-- Trigger for KPI update on status transition to 'Completed'
CREATE OR REPLACE FUNCTION update_kpi_mapping_request()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'Completed' AND OLD.status != 'Completed' THEN
    UPDATE public.kpi_daily_snapshot
    SET mapping_requests_resolved = mapping_requests_resolved + 1
    WHERE user_id = NEW.mapped_by AND date = CURRENT_DATE;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS on_mapping_request_completed ON public.mapping_requests;

DROP TRIGGER IF EXISTS on_mapping_request_completed ON public.mapping_requests;
CREATE TRIGGER on_mapping_request_completed
AFTER UPDATE ON public.mapping_requests
FOR EACH ROW
EXECUTE FUNCTION update_kpi_mapping_request();
-- Enable RLS on remaining tables to comply with Part 2 Security Checklist

ALTER TABLE public.capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_shift_config ENABLE ROW LEVEL SECURITY;

-- Add basic read-only policies for all authenticated users to capabilities

DROP POLICY IF EXISTS "Capabilities are readable by authenticated users" ON public.capabilities;
CREATE POLICY "Capabilities are readable by authenticated users"
ON public.capabilities
FOR SELECT
TO authenticated
USING (true);

-- Add read-only policies for all authenticated users to attendance_shift_config

DROP POLICY IF EXISTS "Attendance shift config is readable by authenticated users" ON public.attendance_shift_config;
CREATE POLICY "Attendance shift config is readable by authenticated users"
ON public.attendance_shift_config
FOR SELECT
TO authenticated
USING (true);

-- Allow admin users to modify attendance_shift_config

DROP POLICY IF EXISTS "Admins can update attendance shift config" ON public.attendance_shift_config;
CREATE POLICY "Admins can update attendance shift config"
ON public.attendance_shift_config
FOR ALL
TO authenticated
USING (public.has_capability('admin'))
WITH CHECK (public.has_capability('admin'));
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
-- Migration to revert free-text unstructured columns and enforce strict relational mappings

-- 1. Revert client_queries table
ALTER TABLE public.client_queries DROP COLUMN IF EXISTS client_name_unregistered;
-- Assuming there might be NULLs, we can only set NOT NULL if we clean them up, but since it's fresh we can try:
-- For safety, we won't strictly enforce NOT NULL on old rows if they are null, but going forward the schema requires it.
-- We will enforce NOT NULL if possible.
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.client_queries WHERE lead_id IS NULL) THEN
    ALTER TABLE public.client_queries ALTER COLUMN lead_id SET NOT NULL;
  END IF;
END $$;

-- 2. Revert mapping_requests table
ALTER TABLE public.mapping_requests DROP COLUMN IF EXISTS distributor_name_unregistered;
ALTER TABLE public.mapping_requests DROP COLUMN IF EXISTS retailer_name_unregistered;

DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.mapping_requests WHERE distributor_lead_id IS NULL OR retailer_lead_id IS NULL) THEN
    ALTER TABLE public.mapping_requests ALTER COLUMN distributor_lead_id SET NOT NULL;
    ALTER TABLE public.mapping_requests ALTER COLUMN retailer_lead_id SET NOT NULL;
  END IF;
END $$;
