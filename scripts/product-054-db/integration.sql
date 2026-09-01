\set ON_ERROR_STOP on

do $$
declare
  a constant uuid := '92000000-0000-4000-a000-000000000001';
  b constant uuid := '92000000-0000-4000-a000-000000000002';
  admin constant uuid := '91000000-0000-4000-a000-000000000001';
  mapping_a constant uuid := '9b000000-0000-4000-a000-000000000001';
  admin_mapping constant uuid := '9b000000-0000-4000-a000-000000000002';
  call_a constant uuid := '9c000000-0000-4000-a000-000000000001';
  admin_call constant uuid := '9c000000-0000-4000-a000-000000000002';
  completed_once timestamptz;
  original_call_time timestamptz;
  affected integer;
begin
  perform set_config('request.jwt.claim.sub',a::text,true); set local role authenticated;
  insert into public.mapping_requests(request_id,distributor_name_unregistered,retailer_name_unregistered,requested_by,mapped_by,status)
  values(mapping_a,'Distributor 1','Retailer 1',b,b,'Pending');
  reset role;
  if not exists(select 1 from public.mapping_requests where request_id=mapping_a and requested_by=a and requested_by_id_snapshot=a and mapped_by is null) then raise exception 'MAPPING_CREATOR_SPOOF_NOT_REBOUND'; end if;

  perform set_config('request.jwt.claim.sub',a::text,true); set local role authenticated;
  update public.mapping_requests set distributor_lead_id='9d000000-0000-4000-a000-000000000001',distributor_name_unregistered='Distributor 2' where request_id=mapping_a;
  update public.mapping_requests set retailer_lead_id='9d000000-0000-4000-a000-000000000002',retailer_name_unregistered='Retailer 2' where request_id=mapping_a;
  update public.mapping_requests set notes='creator note' where request_id=mapping_a;
  update public.mapping_requests set status='Completed',mapped_by=b,completed_at='2000-01-01' where request_id=mapping_a;
  reset role;
  select completed_at into completed_once from public.mapping_requests where request_id=mapping_a;
  if completed_once < now()-interval '1 minute' or not exists(select 1 from public.mapping_requests where request_id=mapping_a and mapped_by=a and mapped_by_id_snapshot=a) then raise exception 'MAPPING_COMPLETION_ACTOR_SPOOFED'; end if;
  perform set_config('request.jwt.claim.sub',a::text,true); set local role authenticated;
  update public.mapping_requests set notes='completed edit' where request_id=mapping_a;
  reset role;
  if (select completed_at from public.mapping_requests where request_id=mapping_a) is distinct from completed_once then raise exception 'MAPPING_COMPLETED_EDIT_RESET_TIME'; end if;
  perform set_config('request.jwt.claim.sub',a::text,true); set local role authenticated;
  update public.mapping_requests set status='Pending' where request_id=mapping_a;
  reset role;
  if not exists(select 1 from public.mapping_requests where request_id=mapping_a and status='Pending' and mapped_by is null and mapped_by_id_snapshot is null and completed_at is null) then raise exception 'MAPPING_REOPEN_FAILED'; end if;
  perform set_config('request.jwt.claim.sub',a::text,true); set local role authenticated;
  update public.mapping_requests set status='Completed' where request_id=mapping_a;
  reset role;
  if not exists(select 1 from public.mapping_requests where request_id=mapping_a and status='Completed' and mapped_by=a and completed_at>completed_once) then raise exception 'MAPPING_RECOMPLETE_FAILED'; end if;

  perform set_config('request.jwt.claim.sub',b::text,true); set local role authenticated;
  update public.mapping_requests set notes='employee poison' where request_id=mapping_a; get diagnostics affected=row_count;
  reset role; if affected<>0 then raise exception 'MAPPING_NON_OWNER_UPDATE_ALLOWED'; end if;
  perform set_config('request.jwt.claim.sub',admin::text,true); set local role authenticated;
  if not exists(select 1 from public.mapping_requests where request_id=mapping_a) then raise exception 'MAPPING_ADMIN_READ_DENIED'; end if;
  update public.mapping_requests set notes='admin poison' where request_id=mapping_a; get diagnostics affected=row_count;
  insert into public.mapping_requests(request_id,distributor_name_unregistered,retailer_name_unregistered,status) values(admin_mapping,'Admin Distributor','Admin Retailer','Pending');
  update public.mapping_requests set notes='admin owner edit' where request_id=admin_mapping;
  reset role;
  if affected<>0 or not exists(select 1 from public.mapping_requests where request_id=admin_mapping and requested_by=admin and notes='admin owner edit') then raise exception 'MAPPING_ADMIN_CREATOR_MATRIX_FAILED'; end if;

  begin
    perform set_config('request.jwt.claim.sub',a::text,true); set local role authenticated;
    update public.mapping_requests set request_id=gen_random_uuid() where request_id=mapping_a;
    raise exception 'MAPPING_REQUEST_ID_MUTABLE';
  exception when insufficient_privilege then reset role; end;
  begin
    perform set_config('request.jwt.claim.sub',a::text,true); set local role authenticated;
    update public.mapping_requests set requested_by=b where request_id=mapping_a;
    raise exception 'MAPPING_REQUESTER_MUTABLE';
  exception when insufficient_privilege then reset role; end;
  begin
    perform set_config('request.jwt.claim.sub',a::text,true); set local role authenticated;
    update public.mapping_requests set created_at=created_at-interval '1 day' where request_id=mapping_a;
    raise exception 'MAPPING_CREATED_AT_MUTABLE';
  exception when insufficient_privilege then reset role; end;
  if (select count(*) from public.mapping_requests where request_id=mapping_a)<>1 then raise exception 'MAPPING_DUPLICATE_CREATED'; end if;

  insert into public.call_logs(log_id,user_id,client_username,client_name,timestamp,outcome,notes) values
    (call_a,a,'client-a','Client A',timezone('utc',now())-interval '1 hour','Happy call','original'),
    (admin_call,admin,'client-admin','Client Admin',timezone('utc',now())-interval '1 hour','Happy call','original');
  select timestamp into original_call_time from public.call_logs where log_id=call_a;
  perform set_config('request.jwt.claim.sub',a::text,true); set local role authenticated;
  update public.call_logs set lead_id='9d000000-0000-4000-a000-000000000003',client_username=null,client_name=null,outcome='Requested more info',notes='owner edit',next_followup_date=current_date+2 where log_id=call_a;
  reset role;
  if not exists(select 1 from public.call_logs where log_id=call_a and user_id=a and outcome='Requested more info' and notes='owner edit' and next_followup_date::date=current_date+2) then raise exception 'CALL_OWNER_UPDATE_FAILED'; end if;
  perform set_config('request.jwt.claim.sub',b::text,true); set local role authenticated;
  update public.call_logs set notes='employee poison' where log_id=call_a; get diagnostics affected=row_count;
  reset role; if affected<>0 then raise exception 'CALL_NON_OWNER_UPDATE_ALLOWED'; end if;
  perform set_config('request.jwt.claim.sub',admin::text,true); set local role authenticated;
  if not exists(select 1 from public.call_logs where log_id=call_a) then raise exception 'CALL_ADMIN_READ_DENIED'; end if;
  update public.call_logs set notes='admin poison' where log_id=call_a; get diagnostics affected=row_count;
  update public.call_logs set notes='admin owner edit' where log_id=admin_call;
  reset role;
  if affected<>0 or not exists(select 1 from public.call_logs where log_id=admin_call and notes='admin owner edit') then raise exception 'CALL_ADMIN_CREATOR_MATRIX_FAILED'; end if;
  begin
    perform set_config('request.jwt.claim.sub',a::text,true); set local role authenticated;
    update public.call_logs set user_id=b where log_id=call_a; raise exception 'CALL_OWNER_MUTABLE';
  exception when insufficient_privilege then reset role; end;
  begin
    perform set_config('request.jwt.claim.sub',a::text,true); set local role authenticated;
    update public.call_logs set log_id=gen_random_uuid() where log_id=call_a; raise exception 'CALL_LOG_ID_MUTABLE';
  exception when insufficient_privilege then reset role; end;
  begin
    perform set_config('request.jwt.claim.sub',a::text,true); set local role authenticated;
    update public.call_logs set timestamp=now() where log_id=call_a; raise exception 'CALL_TIMESTAMP_MUTABLE';
  exception when insufficient_privilege then reset role; end;
  if (select timestamp from public.call_logs where log_id=call_a) is distinct from original_call_time or (select count(*) from public.call_logs where log_id=call_a)<>1 then raise exception 'CALL_AUDIT_OR_DUPLICATE_FAILED'; end if;
end $$;

set role service_role;
do $$
declare
  actor constant uuid := '91000000-0000-4000-a000-000000000001';
  employee constant uuid := '92000000-0000-4000-a000-000000000001';
  states text[] := array['COLLECTION_SETUP_REQUIRED','UNPAID','PARTIALLY_PAID','PAID'];
  ids uuid[] := array['9e000000-0000-4000-a000-000000000001','9e000000-0000-4000-a000-000000000002','9e000000-0000-4000-a000-000000000003','9e000000-0000-4000-a000-000000000004'];
  i integer; result jsonb; version_now bigint; before_receivables bigint; before_payments bigint; row_before public.distributor_accounts%rowtype;
begin
  insert into public.distributor_accounts(distributor_id,distributor_name,distributor_reference,identity_key,assigned_to,installation_status,training_status,mapping_status,activity_status,billing_status,billed_at,created_by)
  select ids[i],'ERP Matrix '||states[i],'ERP-MATRIX-'||i,'code:erp-matrix-'||i,employee,'done','done','done','active','billed',current_date,actor from generate_subscripts(ids,1) i;
  insert into public.receivables(receivable_id,distributor_id,bill_reference,bill_reference_key,distributor_name,distributor_identity_key,distributor_code,contact_person,bill_amount,bill_due_date,next_follow_up_date,assigned_to,source,created_by)
  select md5('erp-matrix-receivable-'||i)::uuid,ids[i],'ERP-MATRIX-BILL-'||i,'erp-matrix-bill-'||i,'ERP Matrix '||states[i],'code:erp-matrix-'||i,'ERP-MATRIX-'||i,'Matrix',100,current_date,current_date,employee,'manual',actor from generate_series(2,4)i;
  insert into public.receivable_payments(payment_id,receivable_id,amount,payment_date,reported_by,verification_status,verified_by,verified_at) values
    (md5('erp-matrix-payment-3')::uuid,md5('erp-matrix-receivable-3')::uuid,40,current_date,actor,'confirmed',actor,now()),
    (md5('erp-matrix-payment-4')::uuid,md5('erp-matrix-receivable-4')::uuid,100,current_date,actor,'confirmed',actor,now());
  select count(*) into before_receivables from public.receivables; select count(*) into before_payments from public.receivable_payments;
  for i in 1..4 loop
    select version into version_now from public.distributor_accounts where distributor_id=ids[i];
    select public.distributor_erp_payment_status_command_v1(md5('erp-matrix-op-'||i)::uuid,actor,'erp_payment',repeat(i::text,64),jsonb_build_object('distributor_id',ids[i],'expected_version',version_now,'erp_payment_status','paid')) into result;
    if not coalesce((result->>'success')::boolean,false) then raise exception 'ERP_BILLED_STATE_REJECTED %: %',states[i],result; end if;
  end loop;
  if (select count(*) from public.receivables)<>before_receivables or (select count(*) from public.receivable_payments)<>before_payments then raise exception 'ERP_COMMAND_MUTATED_FINANCE'; end if;
  select version into version_now from public.distributor_accounts where distributor_id=ids[1];
  select public.distributor_erp_payment_status_command_v1('9f000000-0000-4000-a000-000000000001',actor,'erp_payment',repeat('a',64),jsonb_build_object('distributor_id',ids[1],'expected_version',version_now,'erp_payment_status','not_paid')) into result;
  if not coalesce((result->>'success')::boolean,false) then raise exception 'ERP_NOT_PAID_REJECTED'; end if;
  select public.distributor_erp_payment_status_command_v1('9f000000-0000-4000-a000-000000000001',actor,'erp_payment',repeat('a',64),jsonb_build_object('distributor_id',ids[1],'expected_version',version_now,'erp_payment_status','not_paid')) into result;
  if not coalesce((result->>'success')::boolean,false) then raise exception 'ERP_REPLAY_FAILED'; end if;
  select version into version_now from public.distributor_accounts where distributor_id=ids[2];
  select public.distributor_erp_payment_status_command_v1(gen_random_uuid(),actor,'erp_payment',repeat('b',64),jsonb_build_object('distributor_id',ids[2],'expected_version',version_now-1,'erp_payment_status','paid')) into result;
  if result->>'code'<>'DISTRIBUTOR_CONFLICT' then raise exception 'ERP_STALE_VERSION_ACCEPTED'; end if;
  update public.distributor_accounts set billing_status='not_billed' where distributor_id=ids[2];
  if (select erp_payment_status from public.distributor_accounts where distributor_id=ids[2]) is not null then raise exception 'ERP_UNBILLING_DID_NOT_CLEAR'; end if;
  select version into version_now from public.distributor_accounts where distributor_id=ids[2];
  select public.distributor_erp_payment_status_command_v1(gen_random_uuid(),actor,'erp_payment',repeat('c',64),jsonb_build_object('distributor_id',ids[2],'expected_version',version_now,'erp_payment_status','paid')) into result;
  if result->>'code'<>'ERP_PAYMENT_STATUS_REQUIRES_BILLED' then raise exception 'ERP_NOT_BILLED_PAID_ACCEPTED'; end if;
  select public.distributor_erp_payment_status_command_v1(gen_random_uuid(),actor,'erp_payment',repeat('d',64),jsonb_build_object('distributor_id',ids[2],'expected_version',version_now,'erp_payment_status','not_paid')) into result;
  if result->>'code'<>'ERP_PAYMENT_STATUS_REQUIRES_BILLED' then raise exception 'ERP_NOT_BILLED_NOT_PAID_ACCEPTED'; end if;
  select public.distributor_erp_payment_status_command_v1(gen_random_uuid(),employee,'erp_payment',repeat('e',64),jsonb_build_object('distributor_id',ids[1],'expected_version',version_now,'erp_payment_status','paid')) into result;
  if result->>'code'<>'ADMIN_REQUIRED' then raise exception 'ERP_NON_ADMIN_ACCEPTED'; end if;

  select * into row_before from public.distributor_accounts where distributor_id=ids[1];
  select public.distributor_status_command_v1('9f000000-0000-4000-a000-000000000002',actor,'update',repeat('f',64),to_jsonb(row_before)||jsonb_build_object('expected_version',row_before.version,'billing_status','not_billed','billed_at','','bill_reference','','renewal_date',coalesce(row_before.renewal_date::text,''),'note','unbilling proof')) into result;
  if not coalesce((result->>'success')::boolean,false) or (select erp_payment_status from public.distributor_accounts where distributor_id=ids[1]) is not null then raise exception 'CANONICAL_UNBILLING_CLEAR_FAILED: %',result; end if;
  if not exists(select 1 from public.distributor_status_events where distributor_id=ids[1] and change_set->'before'->>'erp_payment_status'='not_paid' and change_set->'after' ? 'erp_payment_status' and change_set->'after'->'erp_payment_status'='null'::jsonb) then raise exception 'CANONICAL_UNBILLING_AUDIT_MISSING'; end if;
end $$;
reset role;

select 'Migration 054 creator-update and billed ERP matrix passed' as result;
