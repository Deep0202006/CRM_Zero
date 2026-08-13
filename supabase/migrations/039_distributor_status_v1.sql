begin;

create table public.distributor_accounts (
  distributor_id uuid primary key,
  distributor_name text not null check (char_length(btrim(distributor_name)) between 1 and 200),
  distributor_reference text check (distributor_reference is null or char_length(btrim(distributor_reference)) between 1 and 80),
  identity_key text not null check (char_length(identity_key) between 6 and 245),
  lead_id uuid unique references public.leads(lead_id) on delete restrict,
  phone text check (phone is null or char_length(btrim(phone)) <= 40),
  city text check (city is null or char_length(btrim(city)) <= 120),
  assigned_to uuid not null references public.users(user_id) on delete restrict,
  installation_status text not null default 'pending' check (installation_status in ('pending','done')),
  installation_completed_at date,
  training_status text not null default 'pending' check (training_status in ('pending','done')),
  training_completed_at date,
  activity_status text not null default 'not_applicable' check (activity_status in ('not_applicable','active','inactive')),
  billing_status text not null default 'not_billed' check (billing_status in ('not_billed','billed')),
  billed_at date,
  bill_reference text check (bill_reference is null or char_length(btrim(bill_reference)) <= 120),
  renewal_date date,
  version bigint not null default 1 check (version > 0),
  created_by uuid not null references public.users(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint distributor_status_sequence check (
    (installation_status='done' or training_status='pending') and
    ((installation_status='done' and training_status='done') or activity_status='not_applicable')
  ),
  constraint distributor_installation_date check ((installation_status='done') or installation_completed_at is null),
  constraint distributor_training_date check ((training_status='done') or training_completed_at is null),
  constraint distributor_billed_date check ((billing_status='billed') or billed_at is null)
);

create table public.distributor_status_events (
  event_id uuid primary key,
  distributor_id uuid not null references public.distributor_accounts(distributor_id) on delete restrict,
  event_type text not null check (event_type in ('created','status_updated','renewal_date_updated','renewed','reassigned','imported')),
  previous_renewal_date date,
  new_renewal_date date,
  change_set jsonb not null default '{}'::jsonb check (jsonb_typeof(change_set)='object'),
  note text check (note is null or char_length(note)<=1000),
  actor_id uuid not null references public.users(user_id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.distributor_operation_receipts (
  operation_id uuid primary key,
  actor_id uuid not null references public.users(user_id) on delete restrict,
  operation_type text not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  response jsonb not null,
  created_at timestamptz not null default now()
);

create table public.distributor_import_batches (
  batch_id uuid primary key,
  operation_id uuid not null unique,
  actor_id uuid not null references public.users(user_id) on delete restrict,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  filename text not null check (char_length(filename) between 1 and 255),
  row_count integer not null check (row_count between 1 and 5000),
  response jsonb,
  created_at timestamptz not null default now()
);

create index distributor_assignee_renewal_idx on public.distributor_accounts(assigned_to,renewal_date,distributor_id) where renewal_date is not null;
create index distributor_list_updated_idx on public.distributor_accounts(updated_at desc,distributor_id desc);
create unique index distributor_identity_unique_idx on public.distributor_accounts(identity_key);
create unique index distributor_reference_unique_idx on public.distributor_accounts(lower(btrim(distributor_reference))) where distributor_reference is not null;
create index distributor_events_history_idx on public.distributor_status_events(distributor_id,created_at desc,event_id desc);

alter table public.distributor_accounts enable row level security;
alter table public.distributor_status_events enable row level security;
alter table public.distributor_operation_receipts enable row level security;
alter table public.distributor_import_batches enable row level security;

create policy distributor_accounts_read on public.distributor_accounts for select to authenticated using (
  assigned_to=auth.uid() or public.receivables_is_admin(auth.uid())
);
create policy distributor_events_read on public.distributor_status_events for select to authenticated using (
  exists(select 1 from public.distributor_accounts d where d.distributor_id=distributor_status_events.distributor_id and (d.assigned_to=auth.uid() or public.receivables_is_admin(auth.uid())))
);

revoke insert,update,delete on public.distributor_accounts from anon,authenticated;
revoke insert,update,delete on public.distributor_status_events from anon,authenticated;
revoke all on public.distributor_operation_receipts,public.distributor_import_batches from anon,authenticated;
grant select on public.distributor_accounts,public.distributor_status_events to authenticated,service_role;
grant all on public.distributor_accounts,public.distributor_status_events,public.distributor_operation_receipts,public.distributor_import_batches to service_role;

create or replace function public.distributor_renewal_state_v1(p_date date, p_today date)
returns text language sql immutable as $$
  select case when p_date is null then 'none' when p_date<p_today then 'renewal_overdue' when p_date=p_today then 'renewal_due_today' when p_date=p_today+1 then 'renewal_due_tomorrow' when p_date=p_today+2 then 'renewal_due_in_2_days' else 'renewal_upcoming' end
$$;

create or replace function public.distributor_status_command_v1(p_operation_id uuid,p_actor_id uuid,p_operation_type text,p_request_hash text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_existing public.distributor_operation_receipts%rowtype; v_row public.distributor_accounts%rowtype; v_id uuid; v_response jsonb; v_event text; v_old_renewal date; v_new_renewal date;
begin
  if not exists(select 1 from public.users u where u.user_id=p_actor_id and u.is_active=true and public.receivables_is_admin(u.user_id)) then return jsonb_build_object('success',false,'code','ADMIN_REQUIRED'); end if;
  select * into v_existing from public.distributor_operation_receipts where operation_id=p_operation_id for update;
  if found then
    if v_existing.actor_id<>p_actor_id or v_existing.request_hash<>p_request_hash or v_existing.operation_type<>p_operation_type then return jsonb_build_object('success',false,'code','DISTRIBUTOR_OPERATION_MISMATCH'); end if;
    return v_existing.response;
  end if;
  if p_operation_type='create' then
    v_id=(p_payload->>'distributor_id')::uuid;
    if not exists(select 1 from public.users u where u.user_id=(p_payload->>'assigned_to')::uuid and u.is_active=true and not public.receivables_is_admin(u.user_id)) then return jsonb_build_object('success',false,'code','INVALID_ASSIGNEE'); end if;
    insert into public.distributor_accounts(distributor_id,distributor_name,distributor_reference,identity_key,lead_id,phone,city,assigned_to,installation_status,installation_completed_at,training_status,training_completed_at,activity_status,billing_status,billed_at,bill_reference,renewal_date,created_by)
    values(v_id,btrim(p_payload->>'distributor_name'),nullif(btrim(p_payload->>'distributor_reference'),''),p_payload->>'identity_key',nullif(p_payload->>'lead_id','')::uuid,nullif(btrim(p_payload->>'phone'),''),nullif(btrim(p_payload->>'city'),''),(p_payload->>'assigned_to')::uuid,p_payload->>'installation_status',nullif(p_payload->>'installation_completed_at','')::date,p_payload->>'training_status',nullif(p_payload->>'training_completed_at','')::date,p_payload->>'activity_status',p_payload->>'billing_status',nullif(p_payload->>'billed_at','')::date,nullif(btrim(p_payload->>'bill_reference'),''),nullif(p_payload->>'renewal_date','')::date,p_actor_id)
    returning * into v_row; v_event='created';
  elsif p_operation_type in ('update','renew') then
    v_id=(p_payload->>'distributor_id')::uuid;
    select * into v_row from public.distributor_accounts where distributor_id=v_id for update;
    if not found then return jsonb_build_object('success',false,'code','DISTRIBUTOR_NOT_FOUND'); end if;
    if v_row.version<>(p_payload->>'expected_version')::bigint then return jsonb_build_object('success',false,'code','DISTRIBUTOR_CONFLICT','current',to_jsonb(v_row)); end if;
    if not exists(select 1 from public.users u where u.user_id=(p_payload->>'assigned_to')::uuid and u.is_active=true and not public.receivables_is_admin(u.user_id)) then return jsonb_build_object('success',false,'code','INVALID_ASSIGNEE'); end if;
    v_old_renewal=v_row.renewal_date; v_new_renewal=nullif(p_payload->>'renewal_date','')::date;
    update public.distributor_accounts set distributor_name=btrim(p_payload->>'distributor_name'),distributor_reference=nullif(btrim(p_payload->>'distributor_reference'),''),identity_key=p_payload->>'identity_key',lead_id=nullif(p_payload->>'lead_id','')::uuid,phone=nullif(btrim(p_payload->>'phone'),''),city=nullif(btrim(p_payload->>'city'),''),assigned_to=(p_payload->>'assigned_to')::uuid,installation_status=p_payload->>'installation_status',installation_completed_at=nullif(p_payload->>'installation_completed_at','')::date,training_status=p_payload->>'training_status',training_completed_at=nullif(p_payload->>'training_completed_at','')::date,activity_status=p_payload->>'activity_status',billing_status=p_payload->>'billing_status',billed_at=nullif(p_payload->>'billed_at','')::date,bill_reference=nullif(btrim(p_payload->>'bill_reference'),''),renewal_date=v_new_renewal,version=version+1,updated_at=now() where distributor_id=v_id returning * into v_row;
    v_event=case when p_operation_type='renew' then 'renewed' when v_old_renewal is distinct from v_new_renewal then 'renewal_date_updated' else 'status_updated' end;
  else return jsonb_build_object('success',false,'code','INVALID_OPERATION'); end if;
  insert into public.distributor_status_events(event_id,distributor_id,event_type,previous_renewal_date,new_renewal_date,change_set,note,actor_id) values(gen_random_uuid(),v_id,v_event,v_old_renewal,v_row.renewal_date,p_payload,nullif(btrim(p_payload->>'note'),''),p_actor_id);
  v_response=jsonb_build_object('success',true,'record',to_jsonb(v_row));
  insert into public.distributor_operation_receipts(operation_id,actor_id,operation_type,request_hash,response) values(p_operation_id,p_actor_id,p_operation_type,p_request_hash,v_response);
  return v_response;
exception when unique_violation then return jsonb_build_object('success',false,'code','DISTRIBUTOR_DUPLICATE'); end $$;

revoke all on function public.distributor_status_command_v1(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.distributor_status_command_v1(uuid,uuid,text,text,jsonb) to service_role;

create or replace function public.distributor_status_metrics_v1(p_actor_id uuid,p_admin boolean)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object(
  'total',count(*),
  'installation_pending',count(*) filter(where installation_status='pending'),
  'installation_training_done',count(*) filter(where installation_status='done' and training_status='done'),
  'active',count(*) filter(where installation_status='done' and training_status='done' and activity_status='active'),
  'inactive',count(*) filter(where installation_status='done' and training_status='done' and activity_status='inactive'),
  'billed',count(*) filter(where billing_status='billed')
 ) from public.distributor_accounts where (p_admin and public.receivables_is_admin(p_actor_id)) or assigned_to=p_actor_id
$$;

create or replace function public.distributor_renewals_due_v1(p_actor_id uuid,p_admin boolean,p_limit integer default 5)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 with due as (
  select d.distributor_id,d.distributor_name,d.renewal_date,public.distributor_renewal_state_v1(d.renewal_date,(now() at time zone 'Asia/Kolkata')::date) renewal_state
  from public.distributor_accounts d
  where ((p_admin and public.receivables_is_admin(p_actor_id)) or d.assigned_to=p_actor_id)
    and d.renewal_date is not null and d.renewal_date <= (now() at time zone 'Asia/Kolkata')::date + 2
 ), counted as (select *,count(*) over() total_count from due)
 select jsonb_build_object('total',coalesce(max(total_count),0),'rows',coalesce(jsonb_agg(jsonb_build_object('distributor_id',distributor_id,'distributor_name',distributor_name,'renewal_date',renewal_date,'renewal_state',renewal_state) order by renewal_date,distributor_id) filter(where rn<=greatest(1,least(p_limit,50))),'[]'::jsonb))
 from (select *,row_number() over(order by renewal_date,distributor_id) rn from counted) ordered
$$;

revoke all on function public.distributor_status_metrics_v1(uuid,boolean),public.distributor_renewals_due_v1(uuid,boolean,integer) from public,anon,authenticated;
grant execute on function public.distributor_status_metrics_v1(uuid,boolean),public.distributor_renewals_due_v1(uuid,boolean,integer) to service_role;

create or replace function public.import_distributor_status_v1(p_operation_id uuid,p_actor_id uuid,p_request_hash text,p_filename text,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_batch public.distributor_import_batches%rowtype; v_item jsonb; v_payload jsonb; v_current public.distributor_accounts%rowtype; v_old_renewal date; v_created integer=0; v_updated integer=0; v_skipped integer=0; v_result jsonb;
begin
 if not exists(select 1 from public.users u where u.user_id=p_actor_id and u.is_active=true and public.receivables_is_admin(u.user_id)) then return jsonb_build_object('success',false,'code','ADMIN_REQUIRED'); end if;
 select * into v_batch from public.distributor_import_batches where operation_id=p_operation_id for update;
 if found then if v_batch.actor_id<>p_actor_id or v_batch.request_hash<>p_request_hash then return jsonb_build_object('success',false,'code','DISTRIBUTOR_OPERATION_MISMATCH'); end if; return v_batch.response||jsonb_build_object('replayed',true); end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 5000 then return jsonb_build_object('success',false,'code','IMPORT_SIZE_INVALID'); end if;
 create temporary table distributor_import_stage(row_number integer primary key,classification text not null,payload jsonb not null) on commit drop;
 for v_item in select value from jsonb_array_elements(p_rows) loop
  v_payload=v_item->'payload';
  if v_item->>'classification' not in ('NEW','UPDATE','EXACT_DUPLICATE') then return jsonb_build_object('success',false,'code','IMPORT_REVALIDATION_REQUIRED'); end if;
  if not exists(select 1 from public.users u where u.user_id=(v_payload->>'assigned_to')::uuid and u.is_active=true and not public.receivables_is_admin(u.user_id)) then return jsonb_build_object('success',false,'code','INVALID_ASSIGNEE'); end if;
  if (v_payload->>'installation_status') not in ('pending','done') or (v_payload->>'training_status') not in ('pending','done') or (v_payload->>'activity_status') not in ('not_applicable','active','inactive') or (v_payload->>'billing_status') not in ('not_billed','billed') then return jsonb_build_object('success',false,'code','INVALID_STATUS'); end if;
  if ((v_payload->>'installation_status')<>'done' and (v_payload->>'training_status')='done') or (((v_payload->>'installation_status')<>'done' or (v_payload->>'training_status')<>'done') and (v_payload->>'activity_status')<>'not_applicable') then return jsonb_build_object('success',false,'code','INVALID_STATUS_COMBINATION'); end if;
  if v_item->>'classification'='UPDATE' then select * into v_current from public.distributor_accounts where distributor_id=(v_payload->>'distributor_id')::uuid for update; if not found or v_current.version<>(v_payload->>'expected_version')::bigint then return jsonb_build_object('success',false,'code','DISTRIBUTOR_CONFLICT'); end if; end if;
  insert into distributor_import_stage values((v_item->>'rowNumber')::integer,v_item->>'classification',v_payload);
 end loop;
 insert into public.distributor_import_batches(batch_id,operation_id,actor_id,request_hash,filename,row_count) values(gen_random_uuid(),p_operation_id,p_actor_id,p_request_hash,btrim(p_filename),jsonb_array_length(p_rows)) returning * into v_batch;
 for v_item in select jsonb_build_object('classification',classification,'payload',payload) from distributor_import_stage order by row_number loop
  v_payload=v_item->'payload';
  if v_item->>'classification'='NEW' then
   insert into public.distributor_accounts(distributor_id,distributor_name,distributor_reference,identity_key,assigned_to,installation_status,installation_completed_at,training_status,training_completed_at,activity_status,billing_status,billed_at,bill_reference,renewal_date,created_by)
   values((v_payload->>'distributor_id')::uuid,btrim(v_payload->>'distributor_name'),nullif(btrim(v_payload->>'distributor_reference'),''),v_payload->>'identity_key',(v_payload->>'assigned_to')::uuid,v_payload->>'installation_status',nullif(v_payload->>'installation_completed_at','')::date,v_payload->>'training_status',nullif(v_payload->>'training_completed_at','')::date,v_payload->>'activity_status',v_payload->>'billing_status',nullif(v_payload->>'billed_at','')::date,nullif(btrim(v_payload->>'bill_reference'),''),nullif(v_payload->>'renewal_date','')::date,p_actor_id) returning * into v_current; v_created=v_created+1;
   insert into public.distributor_status_events values(gen_random_uuid(),v_current.distributor_id,'imported',null,v_current.renewal_date,jsonb_build_object('source','import'),null,p_actor_id,now());
  elsif v_item->>'classification'='UPDATE' then
   select renewal_date into v_old_renewal from public.distributor_accounts where distributor_id=(v_payload->>'distributor_id')::uuid;
   update public.distributor_accounts set distributor_name=btrim(v_payload->>'distributor_name'),distributor_reference=nullif(btrim(v_payload->>'distributor_reference'),''),identity_key=v_payload->>'identity_key',assigned_to=(v_payload->>'assigned_to')::uuid,installation_status=v_payload->>'installation_status',installation_completed_at=nullif(v_payload->>'installation_completed_at','')::date,training_status=v_payload->>'training_status',training_completed_at=nullif(v_payload->>'training_completed_at','')::date,activity_status=v_payload->>'activity_status',billing_status=v_payload->>'billing_status',billed_at=nullif(v_payload->>'billed_at','')::date,bill_reference=nullif(btrim(v_payload->>'bill_reference'),''),renewal_date=nullif(v_payload->>'renewal_date','')::date,version=version+1,updated_at=now() where distributor_id=(v_payload->>'distributor_id')::uuid returning * into v_current; v_updated=v_updated+1;
   insert into public.distributor_status_events values(gen_random_uuid(),v_current.distributor_id,case when v_old_renewal is distinct from v_current.renewal_date then 'renewal_date_updated' else 'imported' end,v_old_renewal,v_current.renewal_date,jsonb_build_object('source','import'),null,p_actor_id,now());
  else v_skipped=v_skipped+1; end if;
 end loop;
 v_result=jsonb_build_object('success',true,'batch_id',v_batch.batch_id,'created_count',v_created,'updated_count',v_updated,'duplicate_count',v_skipped,'replayed',false);update public.distributor_import_batches set response=v_result where batch_id=v_batch.batch_id;return v_result;
exception when unique_violation then raise exception using errcode='ZD101',message='Distributor identity changed during import'; end $$;

revoke all on function public.import_distributor_status_v1(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.import_distributor_status_v1(uuid,uuid,text,text,jsonb) to service_role;

commit;
