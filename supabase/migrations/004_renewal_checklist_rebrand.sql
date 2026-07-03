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
