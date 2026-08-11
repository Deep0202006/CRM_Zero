-- REVIEW-ONLY R3 MIGRATION. OWNER APPROVAL REQUIRED.
-- Replace quadratic JSONB accumulation with an indexed transaction-local stage.
-- No existing business row is read, rewritten, or deleted by this migration.

create or replace function public.import_receivables_v1(
  p_operation_id uuid,p_actor_id uuid,p_request_hash text,p_filename text,p_payload_hash text,p_rows jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_receipt public.receivable_operation_receipts%rowtype;
  v_previous public.receivable_import_batches%rowtype;
  v_existing public.receivables%rowtype;
  v_row jsonb;
  v_batch uuid := gen_random_uuid();
  v_created integer := 0;
  v_duplicates integer := 0;
  v_identity text;
  v_bill_key text;
  v_business_key text;
  v_critical text;
  v_prior_critical text;
  v_result jsonb;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_receipt from public.receivable_operation_receipts where operation_id=p_operation_id;
  if found then
    if v_receipt.actor_id<>p_actor_id or v_receipt.operation_type<>'import' or v_receipt.request_hash<>p_request_hash then
      return jsonb_build_object('success',false,'code','RECEIVABLE_OPERATION_MISMATCH');
    end if;
    return v_receipt.result;
  end if;
  if not public.receivables_is_admin(p_actor_id) then return jsonb_build_object('success',false,'code','ADMIN_REQUIRED'); end if;
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 5000 then return jsonb_build_object('success',false,'code','IMPORT_INVALID'); end if;
  if char_length(p_filename) not between 1 and 255 or p_payload_hash !~ '^[0-9a-f]{64}$' or p_request_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('success',false,'code','IMPORT_INVALID'); end if;

  create temporary table if not exists receivables_import_stage_v1 (
    operation_id uuid not null,
    business_key text not null,
    critical text not null,
    row_number integer not null,
    row_data jsonb not null,
    primary key(operation_id,business_key)
  ) on commit drop;
  delete from pg_temp.receivables_import_stage_v1 where operation_id=p_operation_id;

  -- Phase A: validate/classify into transaction-local state only. No persistent writes.
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if nullif(v_row->>'next_follow_up_date','') is null or (v_row->>'next_follow_up_date')::date < v_today
      or coalesce(v_row->>'bill_amount','') !~ '^[0-9]{1,12}\.[0-9]{2}$' or (v_row->>'bill_amount')::numeric<=0
      or char_length(btrim(v_row->>'bill_reference')) not between 1 and 120
      or char_length(btrim(v_row->>'distributor_name')) not between 1 and 200
      or char_length(btrim(v_row->>'contact_person')) not between 1 and 160
      or char_length(coalesce(v_row->>'notes',''))>1000 then
      return jsonb_build_object('success',false,'code','IMPORT_INVALID','rowNumber',(v_row->>'row_number')::integer);
    end if;
    if not exists(select 1 from public.users where user_id=(v_row->>'assigned_to')::uuid) then
      return jsonb_build_object('success',false,'code','INVALID_ASSIGNEE','rowNumber',(v_row->>'row_number')::integer);
    end if;
    if not exists(select 1 from public.users where user_id=(v_row->>'assigned_to')::uuid and is_active=true) then
      return jsonb_build_object('success',false,'code','IMPORT_EMPLOYEE_CHANGED','rowNumber',(v_row->>'row_number')::integer);
    end if;
    v_identity:=case when nullif(btrim(v_row->>'distributor_code'),'') is not null then 'code:'||lower(btrim(v_row->>'distributor_code')) else 'name:'||lower(regexp_replace(btrim(v_row->>'distributor_name'),'\s+',' ','g')) end;
    v_bill_key:=lower(regexp_replace(btrim(v_row->>'bill_reference'),'\s+',' ','g'));
    v_business_key:=v_identity||'|'||v_bill_key;
    v_critical:=concat_ws('|',(v_row->>'bill_amount')::numeric(14,2),(v_row->>'bill_due_date')::date,(v_row->>'next_follow_up_date')::date,(v_row->>'assigned_to')::uuid,btrim(v_row->>'contact_person'),coalesce(nullif(btrim(v_row->>'contact_phone'),''),''));

    select critical into v_prior_critical from pg_temp.receivables_import_stage_v1 where operation_id=p_operation_id and business_key=v_business_key;
    if found then
      if v_prior_critical=v_critical then v_duplicates:=v_duplicates+1; continue; end if;
      return jsonb_build_object('success',false,'code','IMPORT_REFRESH_REQUIRED','rowNumber',(v_row->>'row_number')::integer);
    end if;
    select * into v_existing from public.receivables where distributor_identity_key=v_identity and bill_reference_key=v_bill_key;
    if found then
      if concat_ws('|',v_existing.bill_amount,v_existing.bill_due_date,v_existing.next_follow_up_date,v_existing.assigned_to,btrim(v_existing.contact_person),coalesce(v_existing.contact_phone,''))=v_critical then
        v_duplicates:=v_duplicates+1; continue;
      end if;
      return jsonb_build_object('success',false,'code','IMPORT_REFRESH_REQUIRED','rowNumber',(v_row->>'row_number')::integer);
    end if;
    insert into pg_temp.receivables_import_stage_v1(operation_id,business_key,critical,row_number,row_data)
    values(p_operation_id,v_business_key,v_critical,(v_row->>'row_number')::integer,v_row||jsonb_build_object('distributor_identity_key',v_identity,'bill_reference_key',v_bill_key));
  end loop;

  select * into v_previous from public.receivable_import_batches where uploaded_by=p_actor_id and payload_hash=p_payload_hash;
  if found then
    v_result:=jsonb_build_object('success',true,'operation_id',p_operation_id,'batch_id',v_previous.batch_id,'created_count',v_previous.created_count,'duplicate_count',v_previous.duplicate_count,'invalid_count',v_previous.invalid_count,'replayed_batch',true);
    insert into public.receivable_operation_receipts(operation_id,operation_type,actor_id,request_hash,result) values(p_operation_id,'import',p_actor_id,p_request_hash,v_result);
    return v_result;
  end if;

  -- Phase B: persistent mutation. Unexpected errors propagate and roll back all writes.
  select count(*) into v_created from pg_temp.receivables_import_stage_v1 where operation_id=p_operation_id;
  insert into public.receivable_import_batches(batch_id,uploaded_by,filename,payload_hash,row_count,created_count,duplicate_count,invalid_count)
  values(v_batch,p_actor_id,p_filename,p_payload_hash,jsonb_array_length(p_rows),v_created,v_duplicates,0);
  for v_row in select row_data from pg_temp.receivables_import_stage_v1 where operation_id=p_operation_id order by row_number loop
    insert into public.receivables(receivable_id,bill_reference,bill_reference_key,distributor_name,distributor_identity_key,distributor_code,contact_person,contact_phone,bill_amount,bill_due_date,next_follow_up_date,assigned_to,source,source_batch_id,source_row_number,created_by)
    values((v_row->>'receivable_id')::uuid,v_row->>'bill_reference',v_row->>'bill_reference_key',v_row->>'distributor_name',v_row->>'distributor_identity_key',nullif(btrim(v_row->>'distributor_code'),''),v_row->>'contact_person',nullif(btrim(v_row->>'contact_phone'),''),(v_row->>'bill_amount')::numeric,(v_row->>'bill_due_date')::date,(v_row->>'next_follow_up_date')::date,(v_row->>'assigned_to')::uuid,'import',v_batch,(v_row->>'row_number')::integer,p_actor_id);
    insert into public.receivable_activity_events(activity_id,receivable_id,actor_id,event_type,note,change_set)
    values(gen_random_uuid(),(v_row->>'receivable_id')::uuid,p_actor_id,'created',nullif(v_row->>'notes',''),jsonb_build_object('source','import','batch_id',v_batch,'row_number',(v_row->>'row_number')::integer));
  end loop;
  v_result:=jsonb_build_object('success',true,'operation_id',p_operation_id,'batch_id',v_batch,'created_count',v_created,'duplicate_count',v_duplicates,'invalid_count',0);
  insert into public.receivable_operation_receipts(operation_id,operation_type,actor_id,request_hash,result) values(p_operation_id,'import',p_actor_id,p_request_hash,v_result);
  return v_result;
end $$;

revoke all on function public.import_receivables_v1(uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.import_receivables_v1(uuid,uuid,text,text,text,jsonb) to service_role;
