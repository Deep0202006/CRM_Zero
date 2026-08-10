-- REVIEW-ONLY R3 MIGRATION. DO NOT APPLY WITHOUT OWNER APPROVAL.
-- Future-only authority repair: no existing lead row is rewritten.

alter type public.lead_status add value if not exists 'Renewal Due';

create table if not exists public.pipeline_transition_operations (
  operation_id uuid primary key,
  lead_id uuid not null references public.leads(lead_id) on delete restrict,
  actor_id uuid not null references public.users(user_id) on delete restrict,
  expected_stage text not null,
  target_stage text not null,
  confirmed_at timestamptz not null default now(),
  constraint pipeline_transition_expected_stage_frozen check (expected_stage in ('New','Contacted','Interested','Not Interested','Registration','Installation','Payment','Renewal Due')),
  constraint pipeline_transition_target_stage_frozen check (target_stage in ('New','Contacted','Interested','Not Interested','Registration','Installation','Payment','Renewal Due'))
);

alter table public.pipeline_transition_operations enable row level security;
revoke all on public.pipeline_transition_operations from public, anon, authenticated;
grant select, insert on public.pipeline_transition_operations to service_role;

create index if not exists pipeline_transition_operations_lead_confirmed_idx
  on public.pipeline_transition_operations (lead_id, confirmed_at desc);

create or replace function public.track_lead_stage_change()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then new.stage_entered_at = now(); end if;
  return new;
end;
$$;

drop trigger if exists trg_lead_stage_change on public.leads;
create trigger trg_lead_stage_change
before update of status on public.leads
for each row execute function public.track_lead_stage_change();

create or replace function public.guard_pipeline_employee_status_write()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status
     and auth.uid() is not null
     and coalesce(current_setting('zerodata.pipeline_transition', true), '') <> 'approved' then
    raise exception using errcode = '42501', message = 'Lead status changes require the approved Pipeline transition boundary.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_pipeline_employee_status_write on public.leads;
create trigger trg_guard_pipeline_employee_status_write
before update of status on public.leads
for each row execute function public.guard_pipeline_employee_status_write();

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
begin
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text, 0));
  select * into v_existing from public.pipeline_transition_operations where operation_id = p_operation_id;
  if found then
    if v_existing.lead_id <> p_lead_id or v_existing.actor_id <> p_actor_id
       or v_existing.expected_stage <> p_expected_stage or v_existing.target_stage <> p_target_stage then
      return jsonb_build_object('success', false, 'code', 'PIPELINE_OPERATION_MISMATCH');
    end if;
    select * into v_lead from public.leads where lead_id = p_lead_id;
    select name into v_owner_name from public.users where user_id = v_lead.assigned_to;
    return jsonb_build_object('success', true, 'operation_id', p_operation_id, 'lead', to_jsonb(v_lead) || jsonb_build_object('owner_name', coalesce(v_owner_name, 'Assigned employee')));
  end if;

  if p_expected_stage not in ('New','Contacted','Interested','Not Interested','Registration','Installation','Payment','Renewal Due')
     or p_target_stage not in ('New','Contacted','Interested','Not Interested','Registration','Installation','Payment','Renewal Due') then
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
    ('Interested','Registration'), ('Not Interested','Contacted'), ('Registration','Installation'),
    ('Installation','Payment'), ('Renewal Due','Payment'), ('Renewal Due','Not Interested')
  );
  if not v_allowed then return jsonb_build_object('success', false, 'code', 'PIPELINE_INVALID_TRANSITION'); end if;

  perform set_config('zerodata.pipeline_transition', 'approved', true);
  update public.leads
     set status = p_target_stage::public.lead_status,
         onboarded_at = case when p_target_stage = 'Installation' then now() else onboarded_at end
   where lead_id = p_lead_id
   returning * into v_lead;

  insert into public.pipeline_transition_operations(operation_id, lead_id, actor_id, expected_stage, target_stage)
  values (p_operation_id, p_lead_id, p_actor_id, p_expected_stage, p_target_stage);

  select name into v_owner_name from public.users where user_id = v_lead.assigned_to;
  return jsonb_build_object('success', true, 'operation_id', p_operation_id, 'lead', to_jsonb(v_lead) || jsonb_build_object('owner_name', coalesce(v_owner_name, 'Assigned employee')));
end;
$$;

revoke all on function public.transition_lead_stage(text,text,text,text) from public, anon, authenticated;
revoke all on function public.transition_lead_stage_v2(uuid,uuid,text,text,uuid) from public, anon, authenticated;
grant execute on function public.transition_lead_stage_v2(uuid,uuid,text,text,uuid) to service_role;
