-- OWNER-APPLIED ONLY. Pipeline authority repair; exact data correction is migration 038.
-- No lead, call, visit, user, task, or financial row is deleted.

alter type public.lead_status add value if not exists 'Converted';

create or replace view public.lead_source_performance with (security_invoker=true) as
select
  lead_source, segment_type,
  count(*) as total_leads,
  count(*) filter (where (segment_type::text='Retailer' and status::text='Converted') or (segment_type::text='Distributor' and status::text='Payment')) as converted,
  round(100.0 * count(*) filter (where (segment_type::text='Retailer' and status::text='Converted') or (segment_type::text='Distributor' and status::text='Payment')) / nullif(count(*),0), 1) as conversion_rate_pct
from public.leads
where lead_source is not null
group by lead_source, segment_type;

create or replace view public.avg_time_in_stage with (security_invoker=true) as
select
  status, segment_type,
  round(avg(extract(epoch from (now() - coalesce(stage_entered_at,created_at))) / 86400), 1) as avg_days_in_current_stage
from public.leads
where status::text <> 'Not Interested'
  and not (segment_type::text='Retailer' and status::text='Converted')
  and not (segment_type::text='Distributor' and status::text='Payment')
group by status, segment_type;

alter table public.tasks
  add column if not exists is_active boolean not null default true,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text;

alter table public.pipeline_transition_operations
  add column if not exists event_kind text not null default 'user_transition',
  add column if not exists reason text;
alter table public.pipeline_transition_operations alter column actor_id drop not null;

alter table public.pipeline_transition_operations drop constraint if exists pipeline_transition_expected_stage_frozen;
alter table public.pipeline_transition_operations drop constraint if exists pipeline_transition_target_stage_frozen;
alter table public.pipeline_transition_operations
  add constraint pipeline_transition_expected_stage_frozen
  check (expected_stage in ('New','Contacted','Interested','Not Interested','Registration','Installation','Payment','Converted','Renewal Due')) not valid,
  add constraint pipeline_transition_target_stage_frozen
  check (target_stage in ('New','Contacted','Interested','Not Interested','Registration','Installation','Payment','Converted','Renewal Due')) not valid,
  add constraint pipeline_transition_event_kind_valid
  check (event_kind in ('user_transition','system_correction')) not valid,
  add constraint pipeline_transition_actor_semantics
  check ((event_kind = 'user_transition' and actor_id is not null and reason is null)
      or (event_kind = 'system_correction' and actor_id is null and reason is not null)) not valid;

-- Pipeline may not create employee work through either deployed lead trigger.
drop trigger if exists trg_lead_followup_task on public.leads;
drop trigger if exists trg_init_registration_checklist on public.leads;
drop function if exists public.create_followup_task_on_stage_change();
drop function if exists public.init_registration_checklist();
drop function if exists public.surface_reengagement_leads();
drop function if exists public.process_renewals(date);

-- Preserve the bounded Distributor renewal transition, without generating employee work.
create function public.process_renewals(target_date date)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_corrected integer;
begin
  perform set_config('zerodata.pipeline_transition', 'approved', true);

  with eligible as (
    select lead_id
    from public.leads
    where segment_type::text = 'Distributor'
      and status::text = 'Payment'
      and renewal_date is not null
      and renewal_date <= target_date
    order by renewal_date, lead_id
    limit 500
    for update skip locked
  ), corrected as (
    update public.leads l
    set status = 'Renewal Due'::public.lead_status
    from eligible e
    where l.lead_id = e.lead_id
      and l.segment_type::text = 'Distributor'
      and l.status::text = 'Payment'
      and l.renewal_date is not null
      and l.renewal_date <= target_date
    returning l.lead_id, l.renewal_date
  ), audited as (
    insert into public.pipeline_transition_operations(
      operation_id,lead_id,actor_id,expected_stage,target_stage,event_kind,reason
    )
    select
      md5('distributor_renewal_due:' || lead_id::text || ':' || renewal_date::text)::uuid,
      lead_id,null,'Payment','Renewal Due','system_correction','distributor_renewal_due'
    from corrected
    on conflict (operation_id) do nothing
    returning 1
  )
  select count(*) into v_corrected from audited;

  return v_corrected;
end;
$$;

revoke all on function public.process_renewals(date) from public,anon,authenticated;
grant execute on function public.process_renewals(date) to service_role;

-- Remove the unrelated re-engagement writer and rebuild only the daily renewal authority.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $cron$select cron.unschedule(jobid) from cron.job where jobname in ('nightly-renewals','nightly-reengage')$cron$;
    perform cron.schedule(
      'nightly-renewals',
      '0 6 * * *',
      $job$select public.process_renewals((now() at time zone 'Asia/Kolkata')::date)$job$
    );
  end if;
end $$;

-- Remove only deterministically proven Pipeline-generated work from active workload.
update public.tasks
set is_active = false,
    cancelled_at = coalesce(cancelled_at, now()),
    cancellation_reason = 'pipeline_automatic_work_removed'
where is_active
  and status::text in ('Pending','In Progress')
  and related_lead_id is not null
  and assigned_by is null
  and source::text = 'manual'
  and (
    (
      description ~ '^Lead moved to (Contacted|Interested|Not Interested|Registration|Installation|Payment|Converted|Renewal Due)\. Follow up before it goes stale\.$'
      and title ~ '^Follow up: .+ \((Contacted|Interested|Not Interested|Registration|Installation|Payment|Converted|Renewal Due)\)$'
    )
    or (
      description = 'Required for registration.'
      and (
        title like 'Collect GST certificate:%' or title like 'Collect PAN card:%'
        or title like 'Collect Drug Licence:%' or title like 'Collect Bill Photo:%'
      )
    )
  );

-- Global Pipeline visibility for active authenticated CRM users; ordinary writes remain owner-only.
drop policy if exists "Leads insert" on public.leads;
drop policy if exists "Leads segment access delete" on public.leads;
drop policy if exists "Leads segment access insert" on public.leads;
drop policy if exists "Leads segment access select" on public.leads;
drop policy if exists "Leads segment access update" on public.leads;
drop policy if exists "Leads strict isolation select" on public.leads;
drop policy if exists "Leads strict isolation update" on public.leads;
drop policy if exists "Users can read assigned leads" on public.leads;

create policy "Active users read Pipeline"
on public.leads for select to authenticated
using (exists (select 1 from public.users u where u.user_id = auth.uid() and u.is_active = true));

create policy "Owners create own leads"
on public.leads for insert to authenticated
with check (assigned_to = auth.uid() and exists (select 1 from public.users u where u.user_id = auth.uid() and u.is_active = true));

create policy "Owners update own leads"
on public.leads for update to authenticated
using (assigned_to = auth.uid() and exists (select 1 from public.users u where u.user_id = auth.uid() and u.is_active = true))
with check (assigned_to = auth.uid() and exists (select 1 from public.users u where u.user_id = auth.uid() and u.is_active = true));

create or replace function public.transition_lead_stage_v2(
  p_operation_id uuid,
  p_lead_id uuid,
  p_expected_stage text,
  p_target_stage text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_lead public.leads%rowtype;
  v_existing public.pipeline_transition_operations%rowtype;
  v_owner_name text;
  v_allowed boolean;
  v_actor_active boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));
  select * into v_existing from public.pipeline_transition_operations where operation_id = p_operation_id;
  if found then
    if v_existing.event_kind <> 'user_transition' or v_existing.lead_id <> p_lead_id
       or v_existing.actor_id is distinct from p_actor_id or v_existing.expected_stage <> p_expected_stage
       or v_existing.target_stage <> p_target_stage then
      return jsonb_build_object('success', false, 'code', 'PIPELINE_OPERATION_MISMATCH');
    end if;
    select * into v_lead from public.leads where lead_id = p_lead_id;
    select name into v_owner_name from public.users where user_id = v_lead.assigned_to;
    return jsonb_build_object('success', true, 'operation_id', p_operation_id, 'lead', to_jsonb(v_lead) || jsonb_build_object('owner_name', coalesce(v_owner_name, 'Assigned employee')));
  end if;

  select is_active into v_actor_active from public.users where user_id = p_actor_id;
  if not coalesce(v_actor_active, false) then return jsonb_build_object('success', false, 'code', 'PIPELINE_ACTOR_INACTIVE'); end if;
  if p_expected_stage not in ('New','Contacted','Interested','Not Interested','Registration','Installation','Payment','Converted','Renewal Due')
     or p_target_stage not in ('New','Contacted','Interested','Not Interested','Registration','Installation','Payment','Converted','Renewal Due') then
    return jsonb_build_object('success', false, 'code', 'PIPELINE_INVALID_STAGE');
  end if;

  select * into v_lead from public.leads where lead_id = p_lead_id for update;
  if not found then return jsonb_build_object('success', false, 'code', 'PIPELINE_NOT_FOUND'); end if;
  if v_lead.assigned_to is distinct from p_actor_id then return jsonb_build_object('success', false, 'code', 'PIPELINE_NOT_ASSIGNED'); end if;
  if v_lead.status::text <> p_expected_stage then
    return jsonb_build_object('success', false, 'code', 'PIPELINE_CONFLICT', 'current_stage', v_lead.status::text);
  end if;

  v_allowed := (p_expected_stage, p_target_stage) in (
    ('New','Contacted'), ('Contacted','Interested'), ('Contacted','Not Interested'),
    ('Interested','Registration'), ('Not Interested','Contacted'), ('Registration','Installation')
  ) or (v_lead.segment_type::text = 'Retailer' and (p_expected_stage, p_target_stage) in (
    ('Installation','Converted'), ('Renewal Due','Converted'), ('Renewal Due','Not Interested')
  )) or (v_lead.segment_type::text = 'Distributor' and (p_expected_stage, p_target_stage) in (
    ('Installation','Payment'), ('Renewal Due','Payment'), ('Renewal Due','Not Interested')
  ));
  if not v_allowed then
    return jsonb_build_object('success', false, 'code', case when v_lead.segment_type::text = 'Retailer' and p_target_stage = 'Payment' then 'PIPELINE_RETAILER_PAYMENT_FORBIDDEN' else 'PIPELINE_INVALID_TRANSITION' end);
  end if;

  perform set_config('zerodata.pipeline_transition', 'approved', true);
  update public.leads
  set status = p_target_stage::public.lead_status,
      onboarded_at = case when p_target_stage in ('Installation','Converted') then coalesce(onboarded_at, now()) else onboarded_at end
  where lead_id = p_lead_id
  returning * into v_lead;

  insert into public.pipeline_transition_operations(operation_id,lead_id,actor_id,expected_stage,target_stage,event_kind)
  values (p_operation_id,p_lead_id,p_actor_id,p_expected_stage,p_target_stage,'user_transition');
  select name into v_owner_name from public.users where user_id = v_lead.assigned_to;
  return jsonb_build_object('success', true, 'operation_id', p_operation_id, 'lead', to_jsonb(v_lead) || jsonb_build_object('owner_name', coalesce(v_owner_name, 'Assigned employee')));
end;
$$;

revoke all on function public.transition_lead_stage(text,text,text,text) from public,anon,authenticated;
revoke all on function public.transition_lead_stage_v2(uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.transition_lead_stage_v2(uuid,uuid,text,text,uuid) to service_role;
