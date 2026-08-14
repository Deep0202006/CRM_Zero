begin;

alter table public.distributor_accounts add column mapping_status text;
alter table public.distributor_accounts add column mapped_at date;
alter table public.distributor_accounts alter column mapping_status set default 'pending';
alter table public.distributor_accounts add constraint distributor_mapping_status check (mapping_status is null or mapping_status in ('pending','done'));
alter table public.distributor_accounts add constraint distributor_mapping_sequence check (mapping_status is distinct from 'done' or (installation_status='done' and training_status='done'));
alter table public.distributor_accounts add constraint distributor_mapped_date check (mapped_at is null or mapping_status='done');

create or replace function public.distributor_status_metrics_v1(p_actor_id uuid,p_admin boolean)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object(
  'total',count(*),
  'installation_pending',count(*) filter(where installation_status<>'done'),
  'training_pending',count(*) filter(where installation_status='done' and training_status<>'done'),
  'installation_training_done',count(*) filter(where installation_status='done' and training_status='done'),
  'mapped',count(*) filter(where installation_status='done' and training_status='done' and mapping_status='done'),
  'active',count(*) filter(where activity_status='active'),
  'inactive',count(*) filter(where activity_status='inactive'),
  'billed',count(*) filter(where billing_status='billed')
 ) from public.distributor_accounts where exists(select 1 from public.users u where u.user_id=p_actor_id and u.is_active=true) and ((p_admin and public.receivables_is_admin(p_actor_id)) or (not p_admin and assigned_to=p_actor_id))
$$;

create or replace function public.distributor_status_command_v1(p_operation_id uuid,p_actor_id uuid,p_operation_type text,p_request_hash text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_receipt public.distributor_operation_receipts%rowtype; v_before public.distributor_accounts%rowtype; v_row public.distributor_accounts%rowtype;
 v_id uuid; v_response jsonb; v_event text; v_old_renewal date; v_new_renewal date; v_change_set jsonb='{}'::jsonb; v_admin boolean;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
 select * into v_receipt from public.distributor_operation_receipts where operation_id=p_operation_id for update;
 if found then
  if v_receipt.actor_id<>p_actor_id or v_receipt.request_hash<>p_request_hash or v_receipt.operation_type<>p_operation_type then return jsonb_build_object('success',false,'code','DISTRIBUTOR_OPERATION_MISMATCH'); end if;
  return v_receipt.response;
 end if;
 select exists(select 1 from public.users u where u.user_id=p_actor_id and u.is_active=true and public.receivables_is_admin(u.user_id)) into v_admin;
 if not exists(select 1 from public.users u where u.user_id=p_actor_id and u.is_active=true) then return jsonb_build_object('success',false,'code','AUTH_REQUIRED'); end if;
 if p_operation_type='create' then
  if not v_admin then return jsonb_build_object('success',false,'code','ADMIN_REQUIRED'); end if;
  if p_payload->>'mapping_status' not in ('pending','done') then return jsonb_build_object('success',false,'code','MAPPING_STATUS_REQUIRED'); end if;
  if not exists(select 1 from public.users u where u.user_id=(p_payload->>'assigned_to')::uuid and u.is_active=true and not public.receivables_is_admin(u.user_id)) then return jsonb_build_object('success',false,'code','INVALID_ASSIGNEE'); end if;
  v_id=(p_payload->>'distributor_id')::uuid;
  insert into public.distributor_accounts(distributor_id,distributor_name,distributor_reference,identity_key,lead_id,phone,city,assigned_to,installation_status,installation_completed_at,training_status,training_completed_at,mapping_status,mapped_at,activity_status,billing_status,billed_at,bill_reference,renewal_date,created_by)
  values(v_id,btrim(p_payload->>'distributor_name'),nullif(btrim(p_payload->>'distributor_reference'),''),p_payload->>'identity_key',nullif(p_payload->>'lead_id','')::uuid,nullif(btrim(p_payload->>'phone'),''),nullif(btrim(p_payload->>'city'),''),(p_payload->>'assigned_to')::uuid,p_payload->>'installation_status',nullif(p_payload->>'installation_completed_at','')::date,p_payload->>'training_status',nullif(p_payload->>'training_completed_at','')::date,p_payload->>'mapping_status',nullif(p_payload->>'mapped_at','')::date,p_payload->>'activity_status',p_payload->>'billing_status',nullif(p_payload->>'billed_at','')::date,nullif(btrim(p_payload->>'bill_reference'),''),nullif(p_payload->>'renewal_date','')::date,p_actor_id)
  returning * into v_row;
  v_event='created'; v_change_set=jsonb_build_object('created',true);
 elsif p_operation_type in ('update','renew') then
  v_id=(p_payload->>'distributor_id')::uuid;
  select * into v_row from public.distributor_accounts where distributor_id=v_id for update;
  if not found then return jsonb_build_object('success',false,'code','DISTRIBUTOR_NOT_FOUND'); end if;
  if v_row.version<>(p_payload->>'expected_version')::bigint then return jsonb_build_object('success',false,'code','DISTRIBUTOR_CONFLICT','current',to_jsonb(v_row)); end if;
  if p_operation_type='renew' and not (v_admin or v_row.assigned_to=p_actor_id) then return jsonb_build_object('success',false,'code','DISTRIBUTOR_NOT_ASSIGNED'); end if;
  if p_operation_type='update' and not v_admin then return jsonb_build_object('success',false,'code','ADMIN_REQUIRED'); end if;
  v_before=v_row; v_old_renewal=v_row.renewal_date; v_new_renewal=nullif(p_payload->>'renewal_date','')::date;
  if p_operation_type='renew' then
   if v_new_renewal is null then return jsonb_build_object('success',false,'code','RENEWAL_DATE_REQUIRED'); end if;
   update public.distributor_accounts set renewal_date=v_new_renewal,version=version+1,updated_at=now() where distributor_id=v_id returning * into v_row;
   v_change_set=jsonb_build_object('renewal_date',jsonb_build_object('from',v_old_renewal,'to',v_new_renewal)); v_event='renewal_date_updated';
  else
   if not exists(select 1 from public.users u where u.user_id=(p_payload->>'assigned_to')::uuid and u.is_active=true and not public.receivables_is_admin(u.user_id)) then return jsonb_build_object('success',false,'code','INVALID_ASSIGNEE'); end if;
   update public.distributor_accounts set distributor_name=btrim(p_payload->>'distributor_name'),distributor_reference=nullif(btrim(p_payload->>'distributor_reference'),''),identity_key=p_payload->>'identity_key',lead_id=nullif(p_payload->>'lead_id','')::uuid,phone=nullif(btrim(p_payload->>'phone'),''),city=nullif(btrim(p_payload->>'city'),''),assigned_to=(p_payload->>'assigned_to')::uuid,installation_status=p_payload->>'installation_status',installation_completed_at=nullif(p_payload->>'installation_completed_at','')::date,training_status=p_payload->>'training_status',training_completed_at=nullif(p_payload->>'training_completed_at','')::date,mapping_status=nullif(p_payload->>'mapping_status',''),mapped_at=nullif(p_payload->>'mapped_at','')::date,activity_status=p_payload->>'activity_status',billing_status=p_payload->>'billing_status',billed_at=nullif(p_payload->>'billed_at','')::date,bill_reference=nullif(btrim(p_payload->>'bill_reference'),''),renewal_date=v_new_renewal,version=version+1,updated_at=now() where distributor_id=v_id returning * into v_row;
   v_change_set=jsonb_build_object('before',to_jsonb(v_before)-array['created_at','updated_at'],'after',to_jsonb(v_row)-array['created_at','updated_at']);
   v_event=case when v_before.assigned_to is distinct from v_row.assigned_to then 'reassigned' else 'status_updated' end;
  end if;
 else return jsonb_build_object('success',false,'code','INVALID_OPERATION'); end if;
 insert into public.distributor_status_events(event_id,distributor_id,event_type,previous_renewal_date,new_renewal_date,change_set,note,actor_id) values(gen_random_uuid(),v_id,v_event,v_old_renewal,v_row.renewal_date,v_change_set,nullif(btrim(p_payload->>'note'),''),p_actor_id);
 v_response=jsonb_build_object('success',true,'record',to_jsonb(v_row));
 insert into public.distributor_operation_receipts(operation_id,actor_id,operation_type,request_hash,response) values(p_operation_id,p_actor_id,p_operation_type,p_request_hash,v_response);
 return v_response;
exception when unique_violation then return jsonb_build_object('success',false,'code','DISTRIBUTOR_DUPLICATE'); end $$;

create or replace function public.import_distributor_status_v1(p_operation_id uuid,p_actor_id uuid,p_request_hash text,p_filename text,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_batch public.distributor_import_batches%rowtype; v_item jsonb; v_payload jsonb; v_before public.distributor_accounts%rowtype; v_current public.distributor_accounts%rowtype; v_created integer=0; v_updated integer=0; v_skipped integer=0; v_result jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
 select * into v_batch from public.distributor_import_batches where operation_id=p_operation_id for update;
 if found then if v_batch.actor_id<>p_actor_id or v_batch.request_hash<>p_request_hash then return jsonb_build_object('success',false,'code','DISTRIBUTOR_OPERATION_MISMATCH'); end if; return v_batch.response; end if;
 if not exists(select 1 from public.users u where u.user_id=p_actor_id and u.is_active=true and public.receivables_is_admin(u.user_id)) then return jsonb_build_object('success',false,'code','ADMIN_REQUIRED'); end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 5000 then return jsonb_build_object('success',false,'code','IMPORT_SIZE_INVALID'); end if;
 create temporary table distributor_import_stage(row_number integer primary key,classification text not null,payload jsonb not null) on commit drop;
 for v_item in select value from jsonb_array_elements(p_rows) loop
 v_payload=v_item->'payload';
  v_before=null;
  if v_item->>'classification' not in ('NEW','UPDATE','EXACT_DUPLICATE') then return jsonb_build_object('success',false,'code','IMPORT_REVALIDATION_REQUIRED'); end if;
  if not exists(select 1 from public.users u where u.user_id=(v_payload->>'assigned_to')::uuid and u.is_active=true and not public.receivables_is_admin(u.user_id)) then return jsonb_build_object('success',false,'code','INVALID_ASSIGNEE'); end if;
  if v_payload->>'mapping_status' not in ('pending','done') then return jsonb_build_object('success',false,'code','MAPPING_STATUS_REQUIRED'); end if;
  if (v_payload->>'mapping_status')='done' and ((v_payload->>'installation_status')<>'done' or (v_payload->>'training_status')<>'done') then return jsonb_build_object('success',false,'code','INVALID_STATUS_COMBINATION'); end if;
  if v_item->>'classification'='UPDATE' then select * into v_current from public.distributor_accounts where distributor_id=(v_payload->>'distributor_id')::uuid for update; if not found or v_current.version<>(v_payload->>'expected_version')::bigint then return jsonb_build_object('success',false,'code','DISTRIBUTOR_CONFLICT'); end if; end if;
  insert into distributor_import_stage values((v_item->>'rowNumber')::integer,v_item->>'classification',v_payload);
 end loop;
 insert into public.distributor_import_batches(batch_id,operation_id,actor_id,request_hash,filename,row_count) values(gen_random_uuid(),p_operation_id,p_actor_id,p_request_hash,btrim(p_filename),jsonb_array_length(p_rows)) returning * into v_batch;
 for v_item in select jsonb_build_object('classification',classification,'payload',payload) from distributor_import_stage order by row_number loop
  v_payload=v_item->'payload';
  v_before=null;
  if v_item->>'classification'='NEW' then
   insert into public.distributor_accounts(distributor_id,distributor_name,distributor_reference,identity_key,assigned_to,installation_status,installation_completed_at,training_status,training_completed_at,mapping_status,mapped_at,activity_status,billing_status,billed_at,bill_reference,renewal_date,created_by)
   values((v_payload->>'distributor_id')::uuid,btrim(v_payload->>'distributor_name'),nullif(btrim(v_payload->>'distributor_reference'),''),v_payload->>'identity_key',(v_payload->>'assigned_to')::uuid,v_payload->>'installation_status',nullif(v_payload->>'installation_completed_at','')::date,v_payload->>'training_status',nullif(v_payload->>'training_completed_at','')::date,v_payload->>'mapping_status',nullif(v_payload->>'mapped_at','')::date,v_payload->>'activity_status',v_payload->>'billing_status',nullif(v_payload->>'billed_at','')::date,nullif(btrim(v_payload->>'bill_reference'),''),nullif(v_payload->>'renewal_date','')::date,p_actor_id) returning * into v_current; v_created=v_created+1;
  elsif v_item->>'classification'='UPDATE' then
   select * into v_before from public.distributor_accounts where distributor_id=(v_payload->>'distributor_id')::uuid;
   update public.distributor_accounts set distributor_name=btrim(v_payload->>'distributor_name'),distributor_reference=nullif(btrim(v_payload->>'distributor_reference'),''),identity_key=v_payload->>'identity_key',assigned_to=(v_payload->>'assigned_to')::uuid,installation_status=v_payload->>'installation_status',installation_completed_at=nullif(v_payload->>'installation_completed_at','')::date,training_status=v_payload->>'training_status',training_completed_at=nullif(v_payload->>'training_completed_at','')::date,mapping_status=v_payload->>'mapping_status',mapped_at=nullif(v_payload->>'mapped_at','')::date,activity_status=v_payload->>'activity_status',billing_status=v_payload->>'billing_status',billed_at=nullif(v_payload->>'billed_at','')::date,bill_reference=nullif(btrim(v_payload->>'bill_reference'),''),renewal_date=nullif(v_payload->>'renewal_date','')::date,version=version+1,updated_at=now() where distributor_id=(v_payload->>'distributor_id')::uuid returning * into v_current; v_updated=v_updated+1;
  else v_skipped=v_skipped+1; continue; end if;
  insert into public.distributor_status_events(event_id,distributor_id,event_type,previous_renewal_date,new_renewal_date,change_set,note,actor_id) values(gen_random_uuid(),v_current.distributor_id,'imported',v_before.renewal_date,v_current.renewal_date,case when v_before.distributor_id is null then jsonb_build_object('source','import') else jsonb_build_object('source','import','before',to_jsonb(v_before)-array['created_at','updated_at'],'after',to_jsonb(v_current)-array['created_at','updated_at']) end,null,p_actor_id);
 end loop;
 v_result=jsonb_build_object('success',true,'batch_id',v_batch.batch_id,'created_count',v_created,'updated_count',v_updated,'duplicate_count',v_skipped,'replayed',false); update public.distributor_import_batches set response=v_result where batch_id=v_batch.batch_id; return v_result;
exception when unique_violation then raise exception using errcode='ZD101',message='Distributor identity changed during import'; end $$;

revoke all on function public.distributor_status_command_v1(uuid,uuid,text,text,jsonb),public.distributor_status_metrics_v1(uuid,boolean),public.import_distributor_status_v1(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.distributor_status_command_v1(uuid,uuid,text,text,jsonb),public.distributor_status_metrics_v1(uuid,boolean),public.import_distributor_status_v1(uuid,uuid,text,text,jsonb) to service_role;

commit;
