begin;

-- CRM-P1-047: one canonical ERP dimension owned by Distributor Status.
-- This migration performs no ERP backfill and no financial data mutation.

create or replace function public.erp_normalized_key_v1(p_value text)
returns text language sql immutable parallel safe as $$
  select lower(regexp_replace(btrim(coalesce(p_value,'')), '\s+', ' ', 'g'))
$$;

create table public.erp_systems (
  erp_id uuid primary key,
  erp_name text not null check (char_length(btrim(erp_name)) between 1 and 160),
  erp_key text not null unique check (char_length(erp_key) between 1 and 160 and erp_key=public.erp_normalized_key_v1(erp_key)),
  created_by uuid not null references public.users(user_id) on delete restrict,
  created_at timestamptz not null default now()
);

alter table public.erp_systems enable row level security;
revoke all on public.erp_systems from public,anon,authenticated;
grant all on public.erp_systems to service_role;

alter table public.distributor_accounts
  add column erp_id uuid references public.erp_systems(erp_id) on delete restrict;

create index distributor_erp_updated_idx on public.distributor_accounts(erp_id,updated_at desc,distributor_id desc);
create index distributor_erp_renewal_idx on public.distributor_accounts(erp_id,renewal_date,distributor_id);

insert into public.capabilities(code,label)
values('erp_partner_viewer','ERP Partner Viewer')
on conflict(code) do update set label=excluded.label;

create table public.erp_partner_scopes (
  user_id uuid not null references public.users(user_id) on delete cascade,
  erp_id uuid not null references public.erp_systems(erp_id) on delete restrict,
  assigned_by uuid not null references public.users(user_id) on delete restrict,
  assigned_at timestamptz not null default now(),
  primary key(user_id,erp_id)
);

create index erp_partner_scopes_erp_idx on public.erp_partner_scopes(erp_id,user_id);
alter table public.erp_partner_scopes enable row level security;
revoke all on public.erp_partner_scopes from public,anon,authenticated;
grant all on public.erp_partner_scopes to service_role;

create or replace function public.is_operational_employee_v1(p_user_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.users u where u.user_id=p_user_id and u.is_active=true)
    and not exists(
      select 1 from public.user_capabilities c
      where c.user_id=p_user_id and c.capability_code in ('admin','erp_partner_viewer')
    )
$$;

revoke all on function public.is_operational_employee_v1(uuid) from public,anon,authenticated;
grant execute on function public.is_operational_employee_v1(uuid) to service_role;

create or replace function public.erp_partner_capability_guard_v1()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.capability_code='erp_partner_viewer' then
    if exists(select 1 from public.user_capabilities c where c.user_id=new.user_id and c.capability_code<>'erp_partner_viewer') then
      raise exception 'ERP_PARTNER_CAPABILITY_EXCLUSIVE' using errcode='ZD201';
    end if;
    if exists(select 1 from public.distributor_accounts d where d.assigned_to=new.user_id)
       or exists(select 1 from public.receivables r where r.assigned_to=new.user_id) then
      raise exception 'ERP_PARTNER_ACTIVE_ASSIGNMENTS' using errcode='ZD202';
    end if;
  elsif exists(select 1 from public.user_capabilities c where c.user_id=new.user_id and c.capability_code='erp_partner_viewer') then
    raise exception 'ERP_PARTNER_CAPABILITY_EXCLUSIVE' using errcode='ZD201';
  end if;
  return new;
end;
$$;

revoke all on function public.erp_partner_capability_guard_v1() from public,anon,authenticated;
create trigger erp_partner_capability_guard_v1
before insert or update of user_id,capability_code on public.user_capabilities
for each row execute function public.erp_partner_capability_guard_v1();

create or replace function public.erp_partner_scope_cleanup_v1()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if old.capability_code='erp_partner_viewer' then delete from public.erp_partner_scopes where user_id=old.user_id; end if;
  return old;
end;
$$;

revoke all on function public.erp_partner_scope_cleanup_v1() from public,anon,authenticated;
create trigger erp_partner_scope_cleanup_v1
after delete on public.user_capabilities
for each row execute function public.erp_partner_scope_cleanup_v1();

create or replace function public.receivables_enforce_operational_assignee_v1()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.is_operational_employee_v1(new.assigned_to) then
    raise exception 'INVALID_ASSIGNEE' using errcode='ZD001',hint='Assign an active internal operational employee.';
  end if;
  return new;
end;
$$;

create or replace function public.resolve_or_create_erp_system_v1(p_actor_id uuid,p_erp_name text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_name text:=regexp_replace(btrim(coalesce(p_erp_name,'')),'\s+',' ','g'); v_key text; v_row public.erp_systems%rowtype; v_created boolean:=false;
begin
  if not exists(select 1 from public.users u where u.user_id=p_actor_id and u.is_active=true and public.receivables_is_admin(u.user_id)) then
    return jsonb_build_object('success',false,'code','ADMIN_REQUIRED');
  end if;
  v_key:=public.erp_normalized_key_v1(v_name);
  if char_length(v_name) not between 1 and 160 then return jsonb_build_object('success',false,'code','ERP_NAME_INVALID'); end if;
  select * into v_row from public.erp_systems where erp_key=v_key for update;
  if not found then
    insert into public.erp_systems(erp_id,erp_name,erp_key,created_by)
    values(md5('erp:'||v_key)::uuid,v_name,v_key,p_actor_id)
    on conflict(erp_key) do nothing returning * into v_row;
    if not found then select * into v_row from public.erp_systems where erp_key=v_key; else v_created:=true; end if;
  end if;
  return jsonb_build_object('success',true,'erp_id',v_row.erp_id,'erp_name',v_row.erp_name,'erp_key',v_row.erp_key,'created',v_created);
end;
$$;

revoke all on function public.resolve_or_create_erp_system_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.resolve_or_create_erp_system_v1(uuid,text) to service_role;

create or replace function public.set_erp_partner_scopes_v1(p_actor_id uuid,p_user_id uuid,p_erp_ids jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_count integer;
begin
  if not exists(select 1 from public.users u where u.user_id=p_actor_id and u.is_active=true and public.receivables_is_admin(u.user_id)) then return jsonb_build_object('success',false,'code','ADMIN_REQUIRED'); end if;
  if not exists(select 1 from public.users u where u.user_id=p_user_id and u.is_active=true) then return jsonb_build_object('success',false,'code','USER_NOT_ACTIVE'); end if;
  if not exists(select 1 from public.user_capabilities c where c.user_id=p_user_id and c.capability_code='erp_partner_viewer') then return jsonb_build_object('success',false,'code','ERP_PARTNER_REQUIRED'); end if;
  if exists(select 1 from public.user_capabilities c where c.user_id=p_user_id and c.capability_code<>'erp_partner_viewer') then return jsonb_build_object('success',false,'code','ERP_PARTNER_CAPABILITY_EXCLUSIVE'); end if;
  if exists(select 1 from public.distributor_accounts d where d.assigned_to=p_user_id) or exists(select 1 from public.receivables r where r.assigned_to=p_user_id) then return jsonb_build_object('success',false,'code','ERP_PARTNER_ACTIVE_ASSIGNMENTS'); end if;
  if jsonb_typeof(p_erp_ids)<>'array' or jsonb_array_length(p_erp_ids)<1 then return jsonb_build_object('success',false,'code','ERP_SCOPE_REQUIRED'); end if;
  if exists(select 1 from jsonb_array_elements_text(p_erp_ids) x(value) left join public.erp_systems e on e.erp_id=x.value::uuid where e.erp_id is null) then return jsonb_build_object('success',false,'code','ERP_SCOPE_INVALID'); end if;
  delete from public.erp_partner_scopes where user_id=p_user_id;
  insert into public.erp_partner_scopes(user_id,erp_id,assigned_by)
  select p_user_id,x.value::uuid,p_actor_id from (select distinct value from jsonb_array_elements_text(p_erp_ids)) x;
  get diagnostics v_count=row_count;
  return jsonb_build_object('success',true,'user_id',p_user_id,'scope_count',v_count);
end;
$$;

revoke all on function public.set_erp_partner_scopes_v1(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.set_erp_partner_scopes_v1(uuid,uuid,jsonb) to service_role;

-- Existing Distributor command authority, extended with canonical erp_id.
create or replace function public.distributor_status_command_v1(p_operation_id uuid,p_actor_id uuid,p_operation_type text,p_request_hash text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_receipt public.distributor_operation_receipts%rowtype; v_before public.distributor_accounts%rowtype; v_row public.distributor_accounts%rowtype; v_id uuid; v_response jsonb; v_event text; v_old_renewal date; v_new_renewal date; v_change_set jsonb='{}'::jsonb; v_admin boolean; v_erp_id uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
 select * into v_receipt from public.distributor_operation_receipts where operation_id=p_operation_id for update;
 if found then if v_receipt.actor_id<>p_actor_id or v_receipt.request_hash<>p_request_hash or v_receipt.operation_type<>p_operation_type then return jsonb_build_object('success',false,'code','DISTRIBUTOR_OPERATION_MISMATCH'); end if; return v_receipt.response; end if;
 select exists(select 1 from public.users u where u.user_id=p_actor_id and u.is_active=true and public.receivables_is_admin(u.user_id)) into v_admin;
 if not exists(select 1 from public.users u where u.user_id=p_actor_id and u.is_active=true) then return jsonb_build_object('success',false,'code','AUTH_REQUIRED'); end if;
 if p_operation_type='create' then
  if not v_admin then return jsonb_build_object('success',false,'code','ADMIN_REQUIRED'); end if;
  if not (p_payload ? 'erp_id') or nullif(p_payload->>'erp_id','') is null then return jsonb_build_object('success',false,'code','ERP_REQUIRED'); end if;
  v_erp_id:=(p_payload->>'erp_id')::uuid;
  if nullif(btrim(p_payload->>'erp_name'),'') is not null then
   insert into public.erp_systems(erp_id,erp_name,erp_key,created_by)
   values(v_erp_id,regexp_replace(btrim(p_payload->>'erp_name'),'\s+',' ','g'),public.erp_normalized_key_v1(p_payload->>'erp_name'),p_actor_id)
   on conflict(erp_key) do nothing;
  end if;
  if not exists(select 1 from public.erp_systems e where e.erp_id=v_erp_id) then return jsonb_build_object('success',false,'code','ERP_INVALID'); end if;
  if coalesce(p_payload->>'mapping_status','pending') not in ('pending','done') then return jsonb_build_object('success',false,'code','MAPPING_STATUS_REQUIRED'); end if;
  if not public.is_operational_employee_v1((p_payload->>'assigned_to')::uuid) then return jsonb_build_object('success',false,'code','INVALID_ASSIGNEE'); end if;
  v_id=(p_payload->>'distributor_id')::uuid;
  insert into public.distributor_accounts(distributor_id,erp_id,distributor_name,distributor_reference,identity_key,lead_id,phone,city,assigned_to,installation_status,installation_completed_at,training_status,training_completed_at,mapping_status,mapped_at,activity_status,billing_status,billed_at,bill_reference,renewal_date,created_by)
  values(v_id,v_erp_id,btrim(p_payload->>'distributor_name'),nullif(btrim(p_payload->>'distributor_reference'),''),p_payload->>'identity_key',nullif(p_payload->>'lead_id','')::uuid,nullif(btrim(p_payload->>'phone'),''),nullif(btrim(p_payload->>'city'),''),(p_payload->>'assigned_to')::uuid,p_payload->>'installation_status',nullif(p_payload->>'installation_completed_at','')::date,p_payload->>'training_status',nullif(p_payload->>'training_completed_at','')::date,coalesce(p_payload->>'mapping_status','pending'),nullif(p_payload->>'mapped_at','')::date,p_payload->>'activity_status',p_payload->>'billing_status',nullif(p_payload->>'billed_at','')::date,nullif(btrim(p_payload->>'bill_reference'),''),nullif(p_payload->>'renewal_date','')::date,p_actor_id) returning * into v_row;
  v_event='created'; v_change_set=jsonb_build_object('created',true,'erp_id',v_erp_id);
 elsif p_operation_type in ('update','renew') then
  v_id=(p_payload->>'distributor_id')::uuid; select * into v_row from public.distributor_accounts where distributor_id=v_id for update;
  if not found then return jsonb_build_object('success',false,'code','DISTRIBUTOR_NOT_FOUND'); end if;
  if p_operation_type='renew' and not (v_admin or v_row.assigned_to=p_actor_id) then return jsonb_build_object('success',false,'code','DISTRIBUTOR_NOT_ASSIGNED'); end if;
  if p_operation_type='update' and not v_admin then return jsonb_build_object('success',false,'code','ADMIN_REQUIRED'); end if;
  if v_row.version<>(p_payload->>'expected_version')::bigint then return jsonb_build_object('success',false,'code','DISTRIBUTOR_CONFLICT','current',to_jsonb(v_row)); end if;
  v_before=v_row; v_old_renewal=v_row.renewal_date; v_new_renewal=nullif(p_payload->>'renewal_date','')::date;
  if p_operation_type='renew' then
   if v_new_renewal is null then return jsonb_build_object('success',false,'code','RENEWAL_DATE_REQUIRED'); end if;
   update public.distributor_accounts set renewal_date=v_new_renewal,version=version+1,updated_at=now() where distributor_id=v_id returning * into v_row;
   v_change_set=jsonb_build_object('renewal_date',jsonb_build_object('from',v_old_renewal,'to',v_new_renewal)); v_event='renewal_date_updated';
  else
   if not public.is_operational_employee_v1((p_payload->>'assigned_to')::uuid) then return jsonb_build_object('success',false,'code','INVALID_ASSIGNEE'); end if;
   v_erp_id:=case when p_payload ? 'erp_id' then nullif(p_payload->>'erp_id','')::uuid else v_row.erp_id end;
   if v_erp_id is not null and nullif(btrim(p_payload->>'erp_name'),'') is not null then
    insert into public.erp_systems(erp_id,erp_name,erp_key,created_by)
    values(v_erp_id,regexp_replace(btrim(p_payload->>'erp_name'),'\s+',' ','g'),public.erp_normalized_key_v1(p_payload->>'erp_name'),p_actor_id)
    on conflict(erp_key) do nothing;
   end if;
   if v_erp_id is not null and not exists(select 1 from public.erp_systems e where e.erp_id=v_erp_id) then return jsonb_build_object('success',false,'code','ERP_INVALID'); end if;
   update public.distributor_accounts set erp_id=v_erp_id,distributor_name=btrim(p_payload->>'distributor_name'),distributor_reference=nullif(btrim(p_payload->>'distributor_reference'),''),identity_key=p_payload->>'identity_key',lead_id=nullif(p_payload->>'lead_id','')::uuid,phone=nullif(btrim(p_payload->>'phone'),''),city=nullif(btrim(p_payload->>'city'),''),assigned_to=(p_payload->>'assigned_to')::uuid,installation_status=p_payload->>'installation_status',installation_completed_at=nullif(p_payload->>'installation_completed_at','')::date,training_status=p_payload->>'training_status',training_completed_at=nullif(p_payload->>'training_completed_at','')::date,mapping_status=case when p_payload ? 'mapping_status' then nullif(p_payload->>'mapping_status','') else mapping_status end,mapped_at=case when p_payload ? 'mapped_at' then nullif(p_payload->>'mapped_at','')::date else mapped_at end,activity_status=p_payload->>'activity_status',billing_status=p_payload->>'billing_status',billed_at=nullif(p_payload->>'billed_at','')::date,bill_reference=nullif(btrim(p_payload->>'bill_reference'),''),renewal_date=v_new_renewal,version=version+1,updated_at=now() where distributor_id=v_id returning * into v_row;
   v_change_set=jsonb_build_object('before',to_jsonb(v_before)-array['created_at','updated_at'],'after',to_jsonb(v_row)-array['created_at','updated_at']);
   v_event=case when v_before.assigned_to is distinct from v_row.assigned_to then 'reassigned' else 'status_updated' end;
  end if;
 else return jsonb_build_object('success',false,'code','INVALID_OPERATION'); end if;
 insert into public.distributor_status_events(event_id,distributor_id,event_type,previous_renewal_date,new_renewal_date,change_set,note,actor_id) values(gen_random_uuid(),v_id,v_event,v_old_renewal,v_row.renewal_date,v_change_set,nullif(btrim(p_payload->>'note'),''),p_actor_id);
 v_response=jsonb_build_object('success',true,'record',to_jsonb(v_row)); insert into public.distributor_operation_receipts(operation_id,actor_id,operation_type,request_hash,response) values(p_operation_id,p_actor_id,p_operation_type,p_request_hash,v_response); return v_response;
exception when unique_violation then return jsonb_build_object('success',false,'code','DISTRIBUTOR_DUPLICATE'); end $$;

-- Legacy single-domain import remains the same authority, now ERP-aware.
create or replace function public.import_distributor_status_v1(p_operation_id uuid,p_actor_id uuid,p_request_hash text,p_filename text,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_batch public.distributor_import_batches%rowtype; v_item jsonb; v_payload jsonb; v_before public.distributor_accounts%rowtype; v_current public.distributor_accounts%rowtype; v_created integer=0; v_updated integer=0; v_skipped integer=0; v_result jsonb; v_command jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
 select * into v_batch from public.distributor_import_batches where operation_id=p_operation_id for update;
 if found then if v_batch.actor_id<>p_actor_id or v_batch.request_hash<>p_request_hash then return jsonb_build_object('success',false,'code','DISTRIBUTOR_OPERATION_MISMATCH'); end if; return v_batch.response; end if;
 if not exists(select 1 from public.users u where u.user_id=p_actor_id and u.is_active=true and public.receivables_is_admin(u.user_id)) then return jsonb_build_object('success',false,'code','ADMIN_REQUIRED'); end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 5000 then return jsonb_build_object('success',false,'code','IMPORT_SIZE_INVALID'); end if;
 create temporary table distributor_import_stage(row_number integer primary key,classification text not null,payload jsonb not null) on commit drop;
 for v_item in select value from jsonb_array_elements(p_rows) loop
  v_payload=v_item->'payload';
  if v_item->>'classification' not in ('NEW','UPDATE','EXACT_DUPLICATE') then return jsonb_build_object('success',false,'code','IMPORT_REVALIDATION_REQUIRED'); end if;
  if not public.is_operational_employee_v1((v_payload->>'assigned_to')::uuid) then return jsonb_build_object('success',false,'code','INVALID_ASSIGNEE'); end if;
  if v_item->>'classification'='NEW' and (not (v_payload ? 'erp_id') or nullif(v_payload->>'erp_id','') is null) then return jsonb_build_object('success',false,'code','ERP_REQUIRED'); end if;
  if (v_payload ? 'erp_id') and nullif(v_payload->>'erp_id','') is not null
     and not exists(select 1 from public.erp_systems e where e.erp_id=(v_payload->>'erp_id')::uuid)
     and nullif(btrim(v_payload->>'erp_name'),'') is null then
    return jsonb_build_object('success',false,'code','ERP_INVALID');
  end if;
  insert into distributor_import_stage values((v_item->>'rowNumber')::integer,v_item->>'classification',v_payload);
 end loop;
 for v_item in select jsonb_build_object('payload',payload) from distributor_import_stage where classification in ('UPDATE','EXACT_DUPLICATE') order by (payload->>'distributor_id')::uuid loop
  v_payload=v_item->'payload'; select * into v_current from public.distributor_accounts where distributor_id=(v_payload->>'distributor_id')::uuid for update;
  if not found or v_current.version<>(v_payload->>'expected_version')::bigint then return jsonb_build_object('success',false,'code','DISTRIBUTOR_CONFLICT'); end if;
 end loop;
 insert into public.erp_systems(erp_id,erp_name,erp_key,created_by)
 select distinct (payload->>'erp_id')::uuid,
   regexp_replace(btrim(payload->>'erp_name'),'\s+',' ','g'),
   public.erp_normalized_key_v1(payload->>'erp_name'),p_actor_id
 from distributor_import_stage
 where nullif(payload->>'erp_id','') is not null
   and nullif(btrim(payload->>'erp_name'),'') is not null
 on conflict(erp_key) do nothing;
 if exists(
   select 1 from distributor_import_stage s
   where nullif(s.payload->>'erp_id','') is not null
     and not exists(select 1 from public.erp_systems e where e.erp_id=(s.payload->>'erp_id')::uuid)
 ) then
   raise exception using errcode='ZD106',message='ERP_INVALID';
 end if;
 insert into public.distributor_import_batches(batch_id,operation_id,actor_id,request_hash,filename,row_count) values(gen_random_uuid(),p_operation_id,p_actor_id,p_request_hash,btrim(p_filename),jsonb_array_length(p_rows)) returning * into v_batch;
 for v_item in select jsonb_build_object('rowNumber',row_number,'classification',classification,'payload',payload) from distributor_import_stage order by row_number loop
  if v_item->>'classification'='EXACT_DUPLICATE' then v_skipped:=v_skipped+1; continue; end if;
  v_payload=v_item->'payload';
  select public.distributor_status_command_v1(md5(p_operation_id::text||':row:'||(v_item->>'rowNumber'))::uuid,p_actor_id,case when v_item->>'classification'='NEW' then 'create' else 'update' end,p_request_hash,v_payload) into v_command;
  if not coalesce((v_command->>'success')::boolean,false) then raise exception using errcode='ZD106',message=coalesce(v_command->>'code','DISTRIBUTOR_IMPORT_REJECTED'); end if;
  if v_item->>'classification'='NEW' then v_created:=v_created+1; else v_updated:=v_updated+1; end if;
 end loop;
 v_result=jsonb_build_object('success',true,'batch_id',v_batch.batch_id,'created_count',v_created,'updated_count',v_updated,'duplicate_count',v_skipped,'replayed',false); update public.distributor_import_batches set response=v_result where batch_id=v_batch.batch_id; return v_result;
exception when unique_violation then raise exception using errcode='ZD101',message='Distributor identity changed during import'; end $$;

revoke all on function public.distributor_status_command_v1(uuid,uuid,text,text,jsonb),public.import_distributor_status_v1(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.distributor_status_command_v1(uuid,uuid,text,text,jsonb),public.import_distributor_status_v1(uuid,uuid,text,text,jsonb) to service_role;

create or replace function public.distributor_financial_projection_v2(p_actor_id uuid,p_page integer,p_page_size integer,p_search text default null,p_assigned_to uuid default null,p_payment_filter text default null,p_billing_filter text default null,p_erp_id uuid default null,p_erp_unset boolean default false)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
with bounds as (select greatest(coalesce(p_page,1),1) page,least(greatest(coalesce(p_page_size,50),1),50) page_size),
allowed as (
 select d.*,e.erp_name,e.erp_key from public.distributor_accounts d left join public.erp_systems e on e.erp_id=d.erp_id
 where exists(select 1 from public.users u where u.user_id=p_actor_id and u.is_active=true)
 and (public.receivables_is_admin(p_actor_id) or d.assigned_to=p_actor_id)
 and (p_erp_id is null or d.erp_id=p_erp_id) and (not coalesce(p_erp_unset,false) or d.erp_id is null)
), receivable_money as (
 select r.distributor_id,r.receivable_id,r.lifecycle_status,r.bill_amount,coalesce(p.confirmed_paid_amount,0)::numeric(14,2) confirmed_paid_amount,(r.bill_amount-coalesce(p.confirmed_paid_amount,0))::numeric(14,2) outstanding_amount,coalesce(p.pending_payment_count,0)::integer pending_payment_count
 from allowed d join public.receivables r on r.distributor_id=d.distributor_id left join lateral(select coalesce(sum(rp.amount) filter(where rp.verification_status='confirmed' and rp.reversed_at is null),0)::numeric(14,2) confirmed_paid_amount,count(*) filter(where rp.verification_status='reported')::integer pending_payment_count from public.receivable_payments rp where rp.receivable_id=r.receivable_id)p on true
), financial as (
 select d.distributor_id,count(r.receivable_id) filter(where r.lifecycle_status<>'cancelled')::integer active_receivable_count,coalesce(sum(r.bill_amount) filter(where r.lifecycle_status<>'cancelled'),0)::numeric(14,2) total_bill_amount,coalesce(sum(r.confirmed_paid_amount) filter(where r.lifecycle_status<>'cancelled'),0)::numeric(14,2) confirmed_collected_amount,coalesce(sum(r.outstanding_amount) filter(where r.lifecycle_status<>'cancelled'),0)::numeric(14,2) outstanding_amount,coalesce(sum(r.pending_payment_count) filter(where r.lifecycle_status<>'cancelled'),0)::integer pending_verification_count,coalesce(bool_or(r.lifecycle_status='disputed') filter(where r.lifecycle_status<>'cancelled'),false) has_disputed from allowed d left join receivable_money r on r.distributor_id=d.distributor_id group by d.distributor_id
), classified as (
 select d.*,f.active_receivable_count,f.total_bill_amount,f.confirmed_collected_amount,f.outstanding_amount,f.pending_verification_count,case when f.has_disputed then 'DISPUTED' when f.active_receivable_count=0 and d.billing_status='billed' then 'COLLECTION_SETUP_REQUIRED' when f.active_receivable_count=0 then 'NOT_BILLED' when f.outstanding_amount=0 then 'PAID' when f.confirmed_collected_amount>0 then 'PARTIALLY_PAID' else 'UNPAID' end collection_state,(d.billing_status='not_billed' and f.active_receivable_count>0) billing_collection_mismatch from allowed d join financial f using(distributor_id)
), filtered as (
 select * from classified where (p_search is null or btrim(p_search)='' or distributor_name ilike '%'||replace(replace(replace(btrim(p_search),'%',' '),'_',' '),',',' ')||'%' or distributor_reference ilike '%'||replace(replace(replace(btrim(p_search),'%',' '),'_',' '),',',' ')||'%') and (p_assigned_to is null or assigned_to=p_assigned_to) and (p_billing_filter is null or p_billing_filter='' or billing_status=p_billing_filter) and (p_payment_filter is null or p_payment_filter='' or collection_state=p_payment_filter or (p_payment_filter='NOT_PAID' and collection_state in ('UNPAID','PARTIALLY_PAID')))
), page_rows as (select * from filtered order by updated_at desc,distributor_id desc offset(select(page-1)*page_size from bounds) limit(select page_size from bounds))
select jsonb_build_object('total',(select count(*) from filtered),'rows',coalesce((select jsonb_agg(to_jsonb(page_rows) order by updated_at desc,distributor_id desc) from page_rows),'[]'::jsonb))
$$;

create or replace function public.distributor_renewals_list_v2(p_actor_id uuid,p_admin boolean,p_filter text default 'all',p_page integer default 1,p_page_size integer default 50,p_erp_id uuid default null,p_erp_unset boolean default false)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
with actor as materialized(select public.receivables_is_admin(p_actor_id)is_admin from public.users where user_id=p_actor_id and is_active=true),params as(select(now() at time zone 'Asia/Kolkata')::date business_date,greatest(1,least(coalesce(p_page,1),10000))page_number,greatest(1,least(coalesce(p_page_size,50),50))page_size),authorized as(
 select d.distributor_id,d.distributor_name,d.distributor_reference,d.erp_id,e.erp_name,d.assigned_to,u.name assigned_employee_name,d.renewal_date,public.distributor_renewal_state_v1(d.renewal_date,p.business_date)renewal_state,d.version,d.updated_at,p.business_date,p.page_number,p.page_size from public.distributor_accounts d join public.users u on u.user_id=d.assigned_to left join public.erp_systems e on e.erp_id=d.erp_id cross join actor a cross join params p where ((p_admin and a.is_admin)or(not p_admin and d.assigned_to=p_actor_id))and(p_erp_id is null or d.erp_id=p_erp_id)and(not coalesce(p_erp_unset,false)or d.erp_id is null)
),filtered as(select * from authorized where case coalesce(p_filter,'all') when 'overdue'then renewal_date<business_date when 'today'then renewal_date=business_date when 'tomorrow'then renewal_date=business_date+1 when 'in_two_days'then renewal_date=business_date+2 when 'upcoming'then renewal_date>business_date+2 when 'not_set'then renewal_date is null when 'all'then true else false end),page_rows as(select distributor_id,distributor_name,distributor_reference,erp_id,erp_name,assigned_to,assigned_employee_name,renewal_date,renewal_state,version,updated_at from filtered order by renewal_date asc nulls last,distributor_name,distributor_id offset(select(page_number-1)*page_size from params)limit(select page_size from params))
select jsonb_build_object('total',(select count(*)from filtered),'page',(select page_number from params),'page_size',(select page_size from params),'rows',coalesce((select jsonb_agg(to_jsonb(page_rows)order by renewal_date asc nulls last,distributor_name,distributor_id)from page_rows),'[]'::jsonb))
$$;

create or replace function public.distributor_renewals_due_v2(p_actor_id uuid,p_admin boolean,p_limit integer default 5)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
with due as(select d.distributor_id,d.distributor_name,d.distributor_reference,d.erp_id,e.erp_name,d.renewal_date,public.distributor_renewal_state_v1(d.renewal_date,(now()at time zone 'Asia/Kolkata')::date)renewal_state from public.distributor_accounts d left join public.erp_systems e on e.erp_id=d.erp_id where exists(select 1 from public.users u where u.user_id=p_actor_id and u.is_active=true)and((p_admin and public.receivables_is_admin(p_actor_id))or(not p_admin and d.assigned_to=p_actor_id))and d.renewal_date is not null and d.renewal_date<=(now()at time zone 'Asia/Kolkata')::date+2),counted as(select *,count(*)over()total_count from due)select jsonb_build_object('total',coalesce(max(total_count),0),'rows',coalesce(jsonb_agg(to_jsonb(ordered)-'rn'-'total_count' order by renewal_date,distributor_id)filter(where rn<=greatest(1,least(coalesce(p_limit,5),50))),'[]'::jsonb))from(select *,row_number()over(order by renewal_date,distributor_id)rn from counted)ordered
$$;

create or replace view public.receivables_financial_read_v2 with(security_invoker=true) as
select r.*,d.erp_id,e.erp_name,e.erp_key
from public.receivables_financial_read_v1 r
join public.receivables authority on authority.receivable_id=r.receivable_id
left join public.distributor_accounts d on d.distributor_id=authority.distributor_id
left join public.erp_systems e on e.erp_id=d.erp_id;

revoke all on public.receivables_financial_read_v2 from public,anon,authenticated;
grant select on public.receivables_financial_read_v2 to service_role;

create or replace function public.erp_partner_distributors_v1(p_actor_id uuid,p_erp_id uuid default null,p_search text default null,p_page integer default 1,p_page_size integer default 50)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
with bounds as(select greatest(1,coalesce(p_page,1))page,least(50,greatest(1,coalesce(p_page_size,50)))page_size),scoped as(
 select d.distributor_id,d.distributor_name,d.distributor_reference,e.erp_id,e.erp_name,d.city,d.installation_status,d.installation_completed_at,d.training_status,d.training_completed_at,d.mapping_status,d.mapped_at,d.activity_status,d.billing_status,d.renewal_date,public.distributor_renewal_state_v1(d.renewal_date,(now()at time zone 'Asia/Kolkata')::date)renewal_state,d.updated_at
 from public.distributor_accounts d join public.erp_systems e on e.erp_id=d.erp_id join public.erp_partner_scopes s on s.erp_id=d.erp_id and s.user_id=p_actor_id
 where exists(select 1 from public.users u join public.user_capabilities c on c.user_id=u.user_id and c.capability_code='erp_partner_viewer' where u.user_id=p_actor_id and u.is_active=true)
 and(p_erp_id is null or d.erp_id=p_erp_id)and(p_search is null or btrim(p_search)=''or d.distributor_name ilike '%'||replace(btrim(p_search),'%',' ')||'%'or d.distributor_reference ilike '%'||replace(btrim(p_search),'%',' ')||'%')
),page_rows as(select * from scoped order by updated_at desc,distributor_id desc offset(select(page-1)*page_size from bounds)limit(select page_size from bounds))
select jsonb_build_object('total',(select count(*)from scoped),'rows',coalesce((select jsonb_agg(to_jsonb(page_rows)order by updated_at desc,distributor_id desc)from page_rows),'[]'::jsonb),'scopes',coalesce((select jsonb_agg(jsonb_build_object('erp_id',e.erp_id,'erp_name',e.erp_name)order by e.erp_name)from public.erp_partner_scopes s join public.erp_systems e using(erp_id)where s.user_id=p_actor_id),'[]'::jsonb))
$$;

create or replace function public.erp_partner_renewals_v1(p_actor_id uuid,p_erp_id uuid default null,p_filter text default 'all',p_page integer default 1,p_page_size integer default 50)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
with today as(select(now()at time zone 'Asia/Kolkata')::date d),bounds as(select greatest(1,coalesce(p_page,1))page,least(50,greatest(1,coalesce(p_page_size,50)))page_size),scoped as(
 select d.distributor_id,d.distributor_name,d.distributor_reference,e.erp_id,e.erp_name,d.renewal_date,public.distributor_renewal_state_v1(d.renewal_date,t.d)renewal_state,d.updated_at,t.d business_date
 from public.distributor_accounts d join public.erp_systems e on e.erp_id=d.erp_id join public.erp_partner_scopes s on s.erp_id=d.erp_id and s.user_id=p_actor_id cross join today t
 where exists(select 1 from public.users u join public.user_capabilities c on c.user_id=u.user_id and c.capability_code='erp_partner_viewer' where u.user_id=p_actor_id and u.is_active=true)and(p_erp_id is null or d.erp_id=p_erp_id)
),filtered as(select * from scoped where case coalesce(p_filter,'all')when'overdue'then renewal_date<business_date when'today'then renewal_date=business_date when'tomorrow'then renewal_date=business_date+1 when'in_two_days'then renewal_date=business_date+2 when'all'then true else false end),page_rows as(select * from filtered order by renewal_date asc nulls last,distributor_name,distributor_id offset(select(page-1)*page_size from bounds)limit(select page_size from bounds))
select jsonb_build_object('total',(select count(*)from filtered),'rows',coalesce((select jsonb_agg(to_jsonb(page_rows)-'business_date'order by renewal_date asc nulls last,distributor_name,distributor_id)from page_rows),'[]'::jsonb),'metrics',jsonb_build_object('overdue',(select count(*)from scoped where renewal_date<business_date),'today',(select count(*)from scoped where renewal_date=business_date),'tomorrow',(select count(*)from scoped where renewal_date=business_date+1),'in_two_days',(select count(*)from scoped where renewal_date=business_date+2)))
$$;

revoke all on function public.distributor_financial_projection_v2(uuid,integer,integer,text,uuid,text,text,uuid,boolean),public.distributor_renewals_list_v2(uuid,boolean,text,integer,integer,uuid,boolean),public.distributor_renewals_due_v2(uuid,boolean,integer),public.erp_partner_distributors_v1(uuid,uuid,text,integer,integer),public.erp_partner_renewals_v1(uuid,uuid,text,integer,integer) from public,anon,authenticated;
grant execute on function public.distributor_financial_projection_v2(uuid,integer,integer,text,uuid,text,text,uuid,boolean),public.distributor_renewals_list_v2(uuid,boolean,text,integer,integer,uuid,boolean),public.distributor_renewals_due_v2(uuid,boolean,integer),public.erp_partner_distributors_v1(uuid,uuid,text,integer,integer),public.erp_partner_renewals_v1(uuid,uuid,text,integer,integer) to service_role;

commit;
