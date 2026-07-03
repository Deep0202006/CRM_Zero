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
create table public.lead_registration_checklist (
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
create table public.lead_installation_details (
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
create table public.lead_payment_details (
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

create policy checklist_access on public.lead_registration_checklist for all using (
    exists (select 1 from public.leads l where l.lead_id = lead_registration_checklist.lead_id
        and (l.assigned_to = auth.uid() or public.check_user_capability(auth.uid(), 'admin')))
);
create policy installation_access on public.lead_installation_details for all using (
    exists (select 1 from public.leads l where l.lead_id = lead_installation_details.lead_id
        and (l.assigned_to = auth.uid() or public.check_user_capability(auth.uid(), 'admin')))
);
create policy payment_access on public.lead_payment_details for all using (
    exists (select 1 from public.leads l where l.lead_id = lead_payment_details.lead_id
        and (l.assigned_to = auth.uid() or public.check_user_capability(auth.uid(), 'admin')))
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
