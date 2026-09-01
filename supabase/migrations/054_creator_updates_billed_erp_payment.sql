-- OWNER-MANUAL ONLY: do not apply from Codex/CI except disposable PostgreSQL.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
begin
  if exists (
    select 1 from public.distributor_accounts
    where billing_status is distinct from 'billed' and erp_payment_status is not null
  ) then raise exception 'not-billed distributors have stale ERP payment state'; end if;
end $$;

alter table public.mapping_requests
  drop constraint if exists mapping_requests_completed_attribution_check,
  add constraint mapping_requests_lifecycle_attribution_check check (
  status = 'Pending' and mapped_by is null and mapped_by_id_snapshot is null and mapped_by_name_snapshot is null and completed_at is null
  or
  (status = 'Completed' and mapped_by_id_snapshot is not null and completed_at is not null and (mapped_by is null or mapped_by = mapped_by_id_snapshot))
);

create or replace function public.mapping_request_attribution_guard_v1()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare actor uuid := auth.uid(); actor_name text;
begin
  -- Preserve Migration 051's ON DELETE SET NULL audit-snapshot safety.
  if tg_op = 'UPDATE'
     and ((old.requested_by is not null and new.requested_by is null) or (old.mapped_by is not null and new.mapped_by is null))
     and (new.requested_by is null or new.requested_by = old.requested_by)
     and (new.mapped_by is null or new.mapped_by = old.mapped_by)
     and new.requested_by_id_snapshot is not distinct from old.requested_by_id_snapshot and new.mapped_by_id_snapshot is not distinct from old.mapped_by_id_snapshot
     and new.requested_by_name_snapshot is not distinct from old.requested_by_name_snapshot and new.mapped_by_name_snapshot is not distinct from old.mapped_by_name_snapshot
     and new.request_id is not distinct from old.request_id and new.distributor_lead_id is not distinct from old.distributor_lead_id and new.retailer_lead_id is not distinct from old.retailer_lead_id
     and new.distributor_name_unregistered is not distinct from old.distributor_name_unregistered and new.retailer_name_unregistered is not distinct from old.retailer_name_unregistered
     and new.notes is not distinct from old.notes and new.status is not distinct from old.status and new.created_at is not distinct from old.created_at and new.completed_at is not distinct from old.completed_at then
    return new;
  end if;
  if actor is null then raise exception 'mapping authentication required'; end if;
  select name into actor_name from public.users where user_id = actor and is_active = true and nullif(btrim(name), '') is not null;
  if actor_name is null then raise exception 'active mapping actor profile required'; end if;
  if tg_op = 'INSERT' then
    if new.status <> 'Pending' then raise exception 'mapping requests must start Pending'; end if;
    new.requested_by := actor; new.requested_by_id_snapshot := actor; new.requested_by_name_snapshot := actor_name;
    new.mapped_by := null; new.mapped_by_id_snapshot := null; new.mapped_by_name_snapshot := null; new.completed_at := null;
    return new;
  end if;
  if old.requested_by is distinct from actor then raise exception 'mapping update creator required' using errcode = '42501'; end if;
  if new.request_id is distinct from old.request_id
     or new.requested_by is distinct from old.requested_by
     or new.requested_by_id_snapshot is distinct from old.requested_by_id_snapshot
     or new.requested_by_name_snapshot is distinct from old.requested_by_name_snapshot
     or new.created_at is distinct from old.created_at then
    raise exception 'mapping audit identity is immutable' using errcode = '42501';
  end if;
  if new.status not in ('Pending', 'Completed') then raise exception 'mapping status invalid'; end if;
  new.requested_by := old.requested_by;
  new.requested_by_id_snapshot := old.requested_by_id_snapshot;
  new.requested_by_name_snapshot := old.requested_by_name_snapshot;
  if new.status = 'Pending' then
    new.mapped_by := null; new.mapped_by_id_snapshot := null; new.mapped_by_name_snapshot := null; new.completed_at := null;
  elsif old.status <> 'Completed' then
    new.mapped_by := actor; new.mapped_by_id_snapshot := actor; new.mapped_by_name_snapshot := actor_name;
    new.completed_at := timezone('utc', clock_timestamp());
  else
    new.mapped_by := old.mapped_by; new.mapped_by_id_snapshot := old.mapped_by_id_snapshot;
    new.mapped_by_name_snapshot := old.mapped_by_name_snapshot; new.completed_at := old.completed_at;
  end if;
  return new;
end $$;

drop policy if exists mapping_requests_team_complete on public.mapping_requests;
drop policy if exists mapping_requests_creator_update on public.mapping_requests;
create policy mapping_requests_creator_update on public.mapping_requests for update to authenticated
using (
  requested_by = auth.uid()
  and exists (select 1 from public.users u where u.user_id = auth.uid() and u.is_active = true)
  and (public.has_capability('ret_support') or public.has_capability('dist_support') or public.has_capability('admin'))
)
with check (
  requested_by = auth.uid()
  and exists (select 1 from public.users u where u.user_id = auth.uid() and u.is_active = true)
  and (public.has_capability('ret_support') or public.has_capability('dist_support') or public.has_capability('admin'))
);

create or replace function public.call_log_owner_audit_guard_v1()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.log_id is distinct from old.log_id or new.user_id is distinct from old.user_id or new.timestamp is distinct from old.timestamp then
    raise exception 'call audit identity is immutable' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists call_log_owner_audit_guard_v1 on public.call_logs;
create trigger call_log_owner_audit_guard_v1 before update on public.call_logs for each row execute function public.call_log_owner_audit_guard_v1();
revoke all on function public.call_log_owner_audit_guard_v1() from public, anon, authenticated;

drop policy if exists "Call logs strict isolation update" on public.call_logs;
drop policy if exists call_logs_update_own_or_admin on public.call_logs;
drop policy if exists call_logs_update_creator on public.call_logs;
create policy call_logs_update_creator on public.call_logs for update to authenticated
using (user_id = auth.uid() and exists (select 1 from public.users u where u.user_id = auth.uid() and u.is_active = true))
with check (user_id = auth.uid() and exists (select 1 from public.users u where u.user_id = auth.uid() and u.is_active = true));

alter table public.distributor_accounts add constraint distributor_erp_payment_requires_billed_check
  check (billing_status is not distinct from 'billed' or erp_payment_status is null);

create or replace function public.distributor_erp_payment_billing_guard_v1()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if new.billing_status is distinct from 'billed' then new.erp_payment_status := null; end if;
  return new;
end $$;
drop trigger if exists distributor_erp_payment_billing_guard_v1 on public.distributor_accounts;
create trigger distributor_erp_payment_billing_guard_v1 before insert or update on public.distributor_accounts for each row execute function public.distributor_erp_payment_billing_guard_v1();
revoke all on function public.distributor_erp_payment_billing_guard_v1() from public, anon, authenticated;

create or replace function public.distributor_erp_payment_status_command_v1(
  p_operation_id uuid,p_actor_id uuid,p_operation_type text,p_request_hash text,p_payload jsonb
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_receipt public.distributor_operation_receipts%rowtype;
  v_before public.distributor_accounts%rowtype;
  v_row public.distributor_accounts%rowtype;
  v_id uuid;
  v_status text;
  v_response jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_receipt from public.distributor_operation_receipts where operation_id=p_operation_id for update;
  if found then
    if v_receipt.actor_id<>p_actor_id or v_receipt.request_hash<>p_request_hash or v_receipt.operation_type<>p_operation_type then
      return jsonb_build_object('success',false,'code','DISTRIBUTOR_OPERATION_MISMATCH');
    end if;
    return v_receipt.response;
  end if;
  if p_operation_type<>'erp_payment' then return jsonb_build_object('success',false,'code','INVALID_OPERATION'); end if;
  if not exists(
    select 1 from public.users u
    where u.user_id=p_actor_id and u.is_active=true and public.receivables_is_admin(u.user_id)
  ) then return jsonb_build_object('success',false,'code','ADMIN_REQUIRED'); end if;
  v_id=(p_payload->>'distributor_id')::uuid;
  v_status=nullif(p_payload->>'erp_payment_status','');
  if v_status is null or v_status not in ('paid','not_paid') then
    return jsonb_build_object('success',false,'code','ERP_PAYMENT_STATUS_INVALID');
  end if;
  if coalesce(p_payload->>'expected_version','')!~'^[1-9][0-9]*$' then
    return jsonb_build_object('success',false,'code','DISTRIBUTOR_VERSION_INVALID');
  end if;
  select * into v_row from public.distributor_accounts where distributor_id=v_id for update;
  if not found then return jsonb_build_object('success',false,'code','DISTRIBUTOR_NOT_FOUND'); end if;
  if v_row.version<>(p_payload->>'expected_version')::bigint then
    return jsonb_build_object('success',false,'code','DISTRIBUTOR_CONFLICT','current',to_jsonb(v_row));
  end if;
  if v_row.billing_status is distinct from 'billed' then
    return jsonb_build_object('success',false,'code','ERP_PAYMENT_STATUS_REQUIRES_BILLED');
  end if;
  v_before=v_row;
  update public.distributor_accounts
  set erp_payment_status=v_status,version=version+1,updated_at=now()
  where distributor_id=v_id returning * into v_row;
  insert into public.distributor_status_events(
    event_id,distributor_id,event_type,previous_renewal_date,new_renewal_date,change_set,note,actor_id
  ) values(
    gen_random_uuid(),v_id,'erp_payment_status_updated',v_row.renewal_date,v_row.renewal_date,
    jsonb_build_object('erp_payment_status',jsonb_build_object('from',v_before.erp_payment_status,'to',v_row.erp_payment_status)),
    nullif(btrim(p_payload->>'note'),''),p_actor_id
  );
  v_response=jsonb_build_object('success',true,'record',to_jsonb(v_row));
  insert into public.distributor_operation_receipts(operation_id,actor_id,operation_type,request_hash,response)
  values(p_operation_id,p_actor_id,p_operation_type,p_request_hash,v_response);
  return v_response;
end $$;

revoke all on function public.distributor_erp_payment_status_command_v1(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.distributor_erp_payment_status_command_v1(uuid,uuid,text,text,jsonb) to service_role;
commit;
