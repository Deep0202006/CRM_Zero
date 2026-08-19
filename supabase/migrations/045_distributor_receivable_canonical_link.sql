-- REVIEW-ONLY R3 MIGRATION. OWNER APPROVAL REQUIRED.
-- Additive canonical identity link. Existing financial rows remain unchanged and
-- retain a NULL distributor_id until a future owner-authorized business action.
alter table public.receivables add column if not exists distributor_id uuid NULL;
alter table public.receivables add constraint receivables_distributor_id_fkey foreign key (distributor_id) references public.distributor_accounts(distributor_id) on delete restrict;
create index if not exists receivables_distributor_id_lookup_idx on public.receivables(distributor_id) where distributor_id is not null;
create unique index if not exists receivables_distributor_bill_reference_uidx
  on public.receivables(distributor_id,bill_reference_key) where distributor_id is not null;

-- Deliberately no historical receivable/payment update, deletion, or backfill.

-- Preserve the deployed five-argument command boundary. The optional UUID is
-- carried inside p_payload so legacy callers remain valid.
create or replace function public.execute_receivable_command_v1(
  p_operation_id uuid,p_operation_type text,p_actor_id uuid,p_request_hash text,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_receipt public.receivable_operation_receipts%rowtype;
  v_r public.receivables%rowtype;
  v_distributor public.distributor_accounts%rowtype;
  v_distributor_id uuid;
  v_assigned_to uuid;
  v_payment public.receivable_payments%rowtype;
  v_admin boolean;
  v_paid numeric(14,2);
  v_pending integer;
  v_result jsonb;
  v_event text;
  v_change_set jsonb;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_next_date date;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_receipt from public.receivable_operation_receipts where operation_id=p_operation_id;
  if found then
    if v_receipt.actor_id<>p_actor_id or v_receipt.operation_type<>p_operation_type or v_receipt.request_hash<>p_request_hash then
      return jsonb_build_object('success',false,'code','RECEIVABLE_OPERATION_MISMATCH');
    end if;
    return v_receipt.result;
  end if;
  if not exists(select 1 from public.users where user_id=p_actor_id and is_active=true) then
    return jsonb_build_object('success',false,'code','ACCOUNT_INACTIVE');
  end if;
  v_admin:=public.receivables_is_admin(p_actor_id);

  if p_operation_type='create' then
    if not v_admin then return jsonb_build_object('success',false,'code','ADMIN_REQUIRED'); end if;
    if nullif(btrim(p_payload->>'distributor_id'),'') is not null then
      begin
        v_distributor_id:=(p_payload->>'distributor_id')::uuid;
      exception when invalid_text_representation then
        return jsonb_build_object('success',false,'code','INVALID_DISTRIBUTOR');
      end;
      select * into v_distributor from public.distributor_accounts where distributor_id=v_distributor_id;
      if not found then return jsonb_build_object('success',false,'code','INVALID_DISTRIBUTOR'); end if;
      if v_distributor.billing_status<>'billed' then
        return jsonb_build_object('success',false,'code','INVALID_DISTRIBUTOR_STATUS');
      end if;
      v_assigned_to:=v_distributor.assigned_to;
    else
      v_assigned_to:=(p_payload->>'assigned_to')::uuid;
    end if;
    if not exists(select 1 from public.users where user_id=v_assigned_to) then
      return jsonb_build_object('success',false,'code','INVALID_ASSIGNEE');
    end if;
    if not exists(select 1 from public.users where user_id=v_assigned_to and is_active=true) then
      return jsonb_build_object('success',false,'code','ASSIGNEE_INACTIVE');
    end if;
    if nullif(p_payload->>'next_follow_up_date','') is null or (p_payload->>'next_follow_up_date')::date < v_today then
      return jsonb_build_object('success',false,'code','INVALID_FOLLOW_UP_DATE');
    end if;
    begin
      insert into public.receivables(receivable_id,distributor_id,bill_reference,bill_reference_key,distributor_name,distributor_identity_key,distributor_code,contact_person,contact_phone,bill_amount,bill_due_date,next_follow_up_date,assigned_to,source,created_by)
      values((p_payload->>'receivable_id')::uuid,v_distributor_id,p_payload->>'bill_reference',lower(regexp_replace(btrim(p_payload->>'bill_reference'),'\s+',' ','g')),case when v_distributor_id is not null then v_distributor.distributor_name else p_payload->>'distributor_name' end,case when v_distributor_id is not null then 'distributor:'||v_distributor_id::text when nullif(btrim(p_payload->>'distributor_code'),'') is not null then 'code:'||lower(btrim(p_payload->>'distributor_code')) else 'name:'||lower(regexp_replace(btrim(p_payload->>'distributor_name'),'\s+',' ','g')) end,case when v_distributor_id is not null then v_distributor.distributor_reference else nullif(btrim(p_payload->>'distributor_code'),'') end,p_payload->>'contact_person',nullif(btrim(p_payload->>'contact_phone'),''),(p_payload->>'bill_amount')::numeric,(p_payload->>'bill_due_date')::date,(p_payload->>'next_follow_up_date')::date,v_assigned_to,'manual',p_actor_id)
      returning * into v_r;
    exception when unique_violation then
      return jsonb_build_object('success',false,'code','RECEIVABLE_DUPLICATE');
    end;
    v_event:='created';
    v_change_set:=jsonb_build_object('source','manual');
  else
    select * into v_r from public.receivables where receivable_id=(p_payload->>'receivable_id')::uuid for update;
    if not found then return jsonb_build_object('success',false,'code','RECEIVABLE_NOT_FOUND'); end if;
    if v_r.version<>(p_payload->>'expected_version')::bigint then
      return jsonb_build_object('success',false,'code','RECEIVABLE_CONFLICT','current',to_jsonb(v_r));
    end if;
    if p_operation_type in ('contacted','no_response','promise','payment_report') and (v_admin or v_r.assigned_to<>p_actor_id) then
      return jsonb_build_object('success',false,'code','RECEIVABLE_NOT_ASSIGNED');
    end if;
    if p_operation_type in ('contacted','no_response','promise','payment_report') and v_r.lifecycle_status<>'active' then
      return jsonb_build_object('success',false,'code','RECEIVABLE_NOT_ACTIVE');
    end if;
    select coalesce(sum(amount) filter(where verification_status='confirmed'),0),count(*) filter(where verification_status='reported') into v_paid,v_pending
    from public.receivable_payments where receivable_id=v_r.receivable_id;
    if p_operation_type in ('contacted','no_response','promise','payment_report') and v_r.bill_amount-v_paid<=0 then
      return jsonb_build_object('success',false,'code','RECEIVABLE_ALREADY_PAID');
    end if;
    if p_operation_type in ('contacted','no_response','promise','payment_report') and v_pending>0 then
      return jsonb_build_object('success',false,'code','PAYMENT_VERIFICATION_PENDING');
    end if;

    if p_operation_type in ('contacted','no_response') then
      if nullif(p_payload->>'next_follow_up_date','') is null or (p_payload->>'next_follow_up_date')::date < v_today then
        return jsonb_build_object('success',false,'code','NEXT_FOLLOW_UP_REQUIRED');
      end if;
      v_change_set:=jsonb_build_object('next_follow_up_date',jsonb_build_object('old',v_r.next_follow_up_date,'new',(p_payload->>'next_follow_up_date')::date));
      update public.receivables set next_follow_up_date=(p_payload->>'next_follow_up_date')::date,updated_at=now(),version=version+1 where receivable_id=v_r.receivable_id returning * into v_r;
      v_event:=case when p_operation_type='contacted' then 'followup_contacted' else 'followup_no_response' end;
    elsif p_operation_type='promise' then
      if nullif(p_payload->>'promise_date','') is null or (p_payload->>'promise_date')::date < v_today
        or (nullif(p_payload->>'promise_amount','') is not null and ((p_payload->>'promise_amount')::numeric<=0 or (p_payload->>'promise_amount')::numeric>v_r.bill_amount-v_paid)) then
        return jsonb_build_object('success',false,'code','INVALID_PROMISE');
      end if;
      v_change_set:=jsonb_build_object('next_follow_up_date',jsonb_build_object('old',v_r.next_follow_up_date,'new',(p_payload->>'promise_date')::date));
      update public.receivables set next_follow_up_date=(p_payload->>'promise_date')::date,updated_at=now(),version=version+1 where receivable_id=v_r.receivable_id returning * into v_r;
      v_event:='promise_to_pay';
    elsif p_operation_type='payment_report' then
      if (p_payload->>'payment_date')::date > v_today then return jsonb_build_object('success',false,'code','FUTURE_PAYMENT_DATE'); end if;
      if (p_payload->>'amount')::numeric<=0 or (p_payload->>'amount')::numeric>v_r.bill_amount-v_paid then return jsonb_build_object('success',false,'code','PAYMENT_NOT_ELIGIBLE'); end if;
      begin
        insert into public.receivable_payments(payment_id,receivable_id,amount,payment_date,payment_mode,payment_reference,note,reported_by,verification_status)
        values((p_payload->>'payment_id')::uuid,v_r.receivable_id,(p_payload->>'amount')::numeric,(p_payload->>'payment_date')::date,nullif(btrim(p_payload->>'payment_mode'),''),nullif(btrim(p_payload->>'payment_reference'),''),nullif(p_payload->>'note',''),p_actor_id,'reported') returning * into v_payment;
      exception when unique_violation then
        return jsonb_build_object('success',false,'code','PAYMENT_DUPLICATE');
      end;
      update public.receivables set updated_at=now(),version=version+1 where receivable_id=v_r.receivable_id returning * into v_r;
      v_event:='payment_reported';
    elsif p_operation_type in ('confirm_payment','reject_payment','reverse_payment','direct_payment','reassign','update','dispute','resolve_dispute','cancel') then
      if not v_admin then return jsonb_build_object('success',false,'code','ADMIN_REQUIRED'); end if;
      if p_operation_type in ('confirm_payment','reject_payment','reverse_payment') then
        select * into v_payment from public.receivable_payments where payment_id=(p_payload->>'payment_id')::uuid and receivable_id=v_r.receivable_id for update;
        if not found then return jsonb_build_object('success',false,'code','PAYMENT_NOT_FOUND'); end if;
      end if;
      if p_operation_type='confirm_payment' then
        if v_payment.verification_status<>'reported' or v_r.lifecycle_status='cancelled' or v_payment.amount>v_r.bill_amount-v_paid then
          return jsonb_build_object('success',false,'code','PAYMENT_NOT_ELIGIBLE');
        end if;
        v_next_date:=coalesce((p_payload->>'next_follow_up_date')::date,v_r.next_follow_up_date);
        if v_payment.amount<v_r.bill_amount-v_paid and (v_next_date is null or v_next_date<v_today) then
          return jsonb_build_object('success',false,'code','NEXT_FOLLOW_UP_REQUIRED');
        end if;
        update public.receivable_payments set verification_status='confirmed',verified_by=p_actor_id,verified_at=now() where payment_id=v_payment.payment_id;
        update public.receivables set next_follow_up_date=case when v_payment.amount=v_r.bill_amount-v_paid then null else v_next_date end,updated_at=now(),version=version+1 where receivable_id=v_r.receivable_id returning * into v_r;
        v_event:='payment_confirmed';
      elsif p_operation_type='reject_payment' then
        if v_payment.verification_status<>'reported' or nullif(btrim(p_payload->>'reason'),'') is null then return jsonb_build_object('success',false,'code','PAYMENT_NOT_ELIGIBLE'); end if;
        update public.receivable_payments set verification_status='rejected',verified_by=p_actor_id,verified_at=now(),rejection_reason=btrim(p_payload->>'reason') where payment_id=v_payment.payment_id;
        update public.receivables set updated_at=now(),version=version+1 where receivable_id=v_r.receivable_id returning * into v_r;
        v_event:='payment_rejected';
      elsif p_operation_type='reverse_payment' then
        if v_payment.verification_status<>'confirmed' or nullif(btrim(p_payload->>'reason'),'') is null then return jsonb_build_object('success',false,'code','PAYMENT_NOT_ELIGIBLE'); end if;
        update public.receivable_payments set verification_status='reversed',reversed_by=p_actor_id,reversed_at=now(),reversal_reason=btrim(p_payload->>'reason') where payment_id=v_payment.payment_id;
        update public.receivables set next_follow_up_date=coalesce((p_payload->>'next_follow_up_date')::date,v_today),updated_at=now(),version=version+1 where receivable_id=v_r.receivable_id returning * into v_r;
        v_event:='payment_reversed';
      elsif p_operation_type='direct_payment' then
        if v_r.lifecycle_status='cancelled' or (p_payload->>'amount')::numeric<=0 or (p_payload->>'amount')::numeric>v_r.bill_amount-v_paid then return jsonb_build_object('success',false,'code','PAYMENT_NOT_ELIGIBLE'); end if;
        if (p_payload->>'payment_date')::date > v_today then return jsonb_build_object('success',false,'code','FUTURE_PAYMENT_DATE'); end if;
        v_next_date:=coalesce((p_payload->>'next_follow_up_date')::date,v_r.next_follow_up_date);
        if (p_payload->>'amount')::numeric<v_r.bill_amount-v_paid and (v_next_date is null or v_next_date<v_today) then return jsonb_build_object('success',false,'code','NEXT_FOLLOW_UP_REQUIRED'); end if;
        begin
          insert into public.receivable_payments(payment_id,receivable_id,amount,payment_date,payment_mode,payment_reference,note,reported_by,verification_status,verified_by,verified_at)
          values((p_payload->>'payment_id')::uuid,v_r.receivable_id,(p_payload->>'amount')::numeric,(p_payload->>'payment_date')::date,nullif(btrim(p_payload->>'payment_mode'),''),nullif(btrim(p_payload->>'payment_reference'),''),nullif(p_payload->>'note',''),p_actor_id,'confirmed',p_actor_id,now()) returning * into v_payment;
        exception when unique_violation then
          return jsonb_build_object('success',false,'code','PAYMENT_DUPLICATE');
        end;
        update public.receivables set next_follow_up_date=case when (p_payload->>'amount')::numeric=v_r.bill_amount-v_paid then null else v_next_date end,updated_at=now(),version=version+1 where receivable_id=v_r.receivable_id returning * into v_r;
        v_event:='payment_confirmed';
      elsif p_operation_type='reassign' then
        if not exists(select 1 from public.users where user_id=(p_payload->>'assigned_to')::uuid) then return jsonb_build_object('success',false,'code','INVALID_ASSIGNEE'); end if;
        if not exists(select 1 from public.users where user_id=(p_payload->>'assigned_to')::uuid and is_active=true) then return jsonb_build_object('success',false,'code','ASSIGNEE_INACTIVE'); end if;
        v_change_set:=jsonb_build_object('assigned_to',jsonb_build_object('old',v_r.assigned_to,'new',(p_payload->>'assigned_to')::uuid));
        update public.receivables set assigned_to=(p_payload->>'assigned_to')::uuid,updated_at=now(),version=version+1 where receivable_id=v_r.receivable_id returning * into v_r;
        v_event:='assigned';
      elsif p_operation_type='update' then
        if (p_payload ? 'bill_amount') and (p_payload->>'bill_amount')::numeric<v_paid then return jsonb_build_object('success',false,'code','BILL_BELOW_CONFIRMED'); end if;
        v_next_date:=coalesce((p_payload->>'next_follow_up_date')::date,v_r.next_follow_up_date);
        if v_r.lifecycle_status='active' and coalesce((p_payload->>'bill_amount')::numeric,v_r.bill_amount)>v_paid
          and (v_next_date is null or v_next_date<v_today) then return jsonb_build_object('success',false,'code','NEXT_FOLLOW_UP_REQUIRED'); end if;
        v_change_set:=jsonb_strip_nulls(jsonb_build_object(
          'bill_amount',case when p_payload ? 'bill_amount' and (p_payload->>'bill_amount')::numeric is distinct from v_r.bill_amount then jsonb_build_object('old',v_r.bill_amount,'new',(p_payload->>'bill_amount')::numeric) end,
          'contact_person',case when p_payload ? 'contact_person' and p_payload->>'contact_person' is distinct from v_r.contact_person then jsonb_build_object('old',v_r.contact_person,'new',p_payload->>'contact_person') end,
          'contact_phone',case when p_payload ? 'contact_phone' and nullif(p_payload->>'contact_phone','') is distinct from v_r.contact_phone then jsonb_build_object('old',v_r.contact_phone,'new',nullif(p_payload->>'contact_phone','')) end,
          'bill_due_date',case when p_payload ? 'bill_due_date' and (p_payload->>'bill_due_date')::date is distinct from v_r.bill_due_date then jsonb_build_object('old',v_r.bill_due_date,'new',(p_payload->>'bill_due_date')::date) end,
          'next_follow_up_date',case when p_payload ? 'next_follow_up_date' and (p_payload->>'next_follow_up_date')::date is distinct from v_r.next_follow_up_date then jsonb_build_object('old',v_r.next_follow_up_date,'new',(p_payload->>'next_follow_up_date')::date) end));
        update public.receivables set bill_amount=coalesce((p_payload->>'bill_amount')::numeric,bill_amount),contact_person=coalesce(nullif(p_payload->>'contact_person',''),contact_person),contact_phone=case when p_payload ? 'contact_phone' then nullif(p_payload->>'contact_phone','') else contact_phone end,bill_due_date=coalesce((p_payload->>'bill_due_date')::date,bill_due_date),next_follow_up_date=v_next_date,updated_at=now(),version=version+1 where receivable_id=v_r.receivable_id returning * into v_r;
        v_event:='admin_updated';
      elsif p_operation_type='dispute' then
        if v_r.lifecycle_status<>'active' then return jsonb_build_object('success',false,'code','INVALID_RECEIVABLE_STATE'); end if;
        v_change_set:=jsonb_build_object('lifecycle_status',jsonb_build_object('old',v_r.lifecycle_status,'new','disputed'));
        update public.receivables set lifecycle_status='disputed',updated_at=now(),version=version+1 where receivable_id=v_r.receivable_id returning * into v_r;
        v_event:='disputed';
      elsif p_operation_type='resolve_dispute' then
        if v_r.lifecycle_status<>'disputed' then return jsonb_build_object('success',false,'code','INVALID_RECEIVABLE_STATE'); end if;
        v_change_set:=jsonb_build_object('lifecycle_status',jsonb_build_object('old',v_r.lifecycle_status,'new','active'));
        update public.receivables set lifecycle_status='active',updated_at=now(),version=version+1 where receivable_id=v_r.receivable_id returning * into v_r;
        v_event:='dispute_resolved';
      elsif p_operation_type='cancel' then
        if v_r.lifecycle_status not in ('active','disputed') then return jsonb_build_object('success',false,'code','INVALID_RECEIVABLE_STATE'); end if;
        if v_pending>0 then return jsonb_build_object('success',false,'code','PAYMENT_VERIFICATION_PENDING'); end if;
        if v_paid>0 or nullif(btrim(p_payload->>'reason'),'') is null then return jsonb_build_object('success',false,'code','CANCELLATION_UNSAFE'); end if;
        v_change_set:=jsonb_build_object('lifecycle_status',jsonb_build_object('old',v_r.lifecycle_status,'new','cancelled'));
        update public.receivables set lifecycle_status='cancelled',cancelled_at=now(),cancelled_by=p_actor_id,cancellation_reason=btrim(p_payload->>'reason'),next_follow_up_date=null,updated_at=now(),version=version+1 where receivable_id=v_r.receivable_id returning * into v_r;
        v_event:='cancelled';
      end if;
    else
      return jsonb_build_object('success',false,'code','UNKNOWN_OPERATION');
    end if;
  end if;

  insert into public.receivable_activity_events(activity_id,receivable_id,actor_id,event_type,next_follow_up_date,promise_date,promise_amount,payment_id,note,change_set)
  values(gen_random_uuid(),v_r.receivable_id,p_actor_id,v_event,case when v_event in ('followup_contacted','followup_no_response') then v_r.next_follow_up_date end,case when v_event='promise_to_pay' then (p_payload->>'promise_date')::date end,case when v_event='promise_to_pay' then nullif(p_payload->>'promise_amount','')::numeric end,v_payment.payment_id,coalesce(nullif(p_payload->>'reason',''),nullif(p_payload->>'note','')),v_change_set);
  v_result:=jsonb_build_object('success',true,'operation_id',p_operation_id,'receivable_id',v_r.receivable_id,'version',v_r.version,'payment_id',v_payment.payment_id);
  insert into public.receivable_operation_receipts(operation_id,operation_type,actor_id,receivable_id,request_hash,result)
  values(p_operation_id,p_operation_type,p_actor_id,v_r.receivable_id,p_request_hash,v_result);
  return v_result;
end $$;
revoke all on function public.execute_receivable_command_v1(uuid,text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.execute_receivable_command_v1(uuid,text,uuid,text,jsonb) to service_role;

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
  v_distributor public.distributor_accounts%rowtype;
  v_distributor_id uuid;
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
    v_distributor_id:=null;
    v_distributor:=null;
    if nullif(v_row->>'next_follow_up_date','') is null or (v_row->>'next_follow_up_date')::date < v_today
      or coalesce(v_row->>'bill_amount','') !~ '^[0-9]{1,12}\.[0-9]{2}$' or (v_row->>'bill_amount')::numeric<=0
      or char_length(btrim(v_row->>'bill_reference')) not between 1 and 120
      or char_length(btrim(v_row->>'contact_person')) not between 1 and 160
      or char_length(coalesce(v_row->>'notes',''))>1000 then
      return jsonb_build_object('success',false,'code','IMPORT_INVALID','rowNumber',(v_row->>'row_number')::integer);
    end if;
    if nullif(btrim(v_row->>'distributor_id'),'') is not null then
      begin
        v_distributor_id:=(v_row->>'distributor_id')::uuid;
      exception when invalid_text_representation then
        return jsonb_build_object('success',false,'code','INVALID_DISTRIBUTOR','rowNumber',(v_row->>'row_number')::integer);
      end;
      select * into v_distributor from public.distributor_accounts where distributor_id=v_distributor_id;
      if not found then return jsonb_build_object('success',false,'code','INVALID_DISTRIBUTOR','rowNumber',(v_row->>'row_number')::integer); end if;
      if v_distributor.billing_status<>'billed' then return jsonb_build_object('success',false,'code','INVALID_DISTRIBUTOR_STATUS','rowNumber',(v_row->>'row_number')::integer); end if;
      v_row:=v_row||jsonb_build_object('distributor_id',v_distributor_id,'distributor_name',v_distributor.distributor_name,'distributor_code',v_distributor.distributor_reference);
      v_identity:='distributor:'||v_distributor_id::text;
    else
      if char_length(btrim(v_row->>'distributor_name')) not between 1 and 200 then
        return jsonb_build_object('success',false,'code','IMPORT_INVALID','rowNumber',(v_row->>'row_number')::integer);
      end if;
      v_identity:=case when nullif(btrim(v_row->>'distributor_code'),'') is not null then 'code:'||lower(btrim(v_row->>'distributor_code')) else 'name:'||lower(regexp_replace(btrim(v_row->>'distributor_name'),'\s+',' ','g')) end;
    end if;
    if not exists(select 1 from public.users where user_id=(v_row->>'assigned_to')::uuid) then
      return jsonb_build_object('success',false,'code','INVALID_ASSIGNEE','rowNumber',(v_row->>'row_number')::integer);
    end if;
    if not exists(select 1 from public.users where user_id=(v_row->>'assigned_to')::uuid and is_active=true) then
      return jsonb_build_object('success',false,'code','IMPORT_EMPLOYEE_CHANGED','rowNumber',(v_row->>'row_number')::integer);
    end if;
    v_bill_key:=lower(regexp_replace(btrim(v_row->>'bill_reference'),'\s+',' ','g'));
    v_business_key:=v_identity||'|'||v_bill_key;
    v_critical:=concat_ws('|',coalesce(v_distributor_id::text,''),(v_row->>'bill_amount')::numeric(14,2),(v_row->>'bill_due_date')::date,(v_row->>'next_follow_up_date')::date,(v_row->>'assigned_to')::uuid,btrim(v_row->>'contact_person'),coalesce(nullif(btrim(v_row->>'contact_phone'),''),''));

    select critical into v_prior_critical from pg_temp.receivables_import_stage_v1 where operation_id=p_operation_id and business_key=v_business_key;
    if found then
      if v_prior_critical=v_critical then v_duplicates:=v_duplicates+1; continue; end if;
      return jsonb_build_object('success',false,'code','IMPORT_REFRESH_REQUIRED','rowNumber',(v_row->>'row_number')::integer);
    end if;
    if v_distributor_id is not null then
      select * into v_existing from public.receivables where distributor_id=v_distributor_id and bill_reference_key=v_bill_key;
    else
      select * into v_existing from public.receivables where distributor_identity_key=v_identity and bill_reference_key=v_bill_key;
    end if;
    if found then
      if concat_ws('|',coalesce(v_existing.distributor_id::text,''),v_existing.bill_amount,v_existing.bill_due_date,v_existing.next_follow_up_date,v_existing.assigned_to,btrim(v_existing.contact_person),coalesce(v_existing.contact_phone,''))=v_critical then
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
    insert into public.receivables(receivable_id,distributor_id,bill_reference,bill_reference_key,distributor_name,distributor_identity_key,distributor_code,contact_person,contact_phone,bill_amount,bill_due_date,next_follow_up_date,assigned_to,source,source_batch_id,source_row_number,created_by)
    values((v_row->>'receivable_id')::uuid,nullif(v_row->>'distributor_id','')::uuid,v_row->>'bill_reference',v_row->>'bill_reference_key',v_row->>'distributor_name',v_row->>'distributor_identity_key',nullif(btrim(v_row->>'distributor_code'),''),v_row->>'contact_person',nullif(btrim(v_row->>'contact_phone'),''),(v_row->>'bill_amount')::numeric,(v_row->>'bill_due_date')::date,(v_row->>'next_follow_up_date')::date,(v_row->>'assigned_to')::uuid,'import',v_batch,(v_row->>'row_number')::integer,p_actor_id);
    insert into public.receivable_activity_events(activity_id,receivable_id,actor_id,event_type,note,change_set)
    values(gen_random_uuid(),(v_row->>'receivable_id')::uuid,p_actor_id,'created',nullif(v_row->>'notes',''),jsonb_build_object('source','import','batch_id',v_batch,'row_number',(v_row->>'row_number')::integer));
  end loop;
  v_result:=jsonb_build_object('success',true,'operation_id',p_operation_id,'batch_id',v_batch,'created_count',v_created,'duplicate_count',v_duplicates,'invalid_count',0);
  insert into public.receivable_operation_receipts(operation_id,operation_type,actor_id,request_hash,result) values(p_operation_id,'import',p_actor_id,p_request_hash,v_result);
  return v_result;
end $$;

revoke all on function public.import_receivables_v1(uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.import_receivables_v1(uuid,uuid,text,text,text,jsonb) to service_role;

create or replace function public.distributor_financial_projection_v1(p_actor_id uuid,p_page integer,p_page_size integer,p_search text default null,p_assigned_to uuid default null,p_payment_filter text default null,p_billing_filter text default null)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
-- Authority/read budget: Distributor Status is the base, Receivables plus
-- confirmed non-reversed payments are money truth, and the result is capped at
-- 50 rows after server-side filtering. This stable read performs no writes.
with bounds as (
 select greatest(coalesce(p_page,1),1) page,
   least(greatest(coalesce(p_page_size,50),1),50) page_size
), allowed as (
 select d.*
 from public.distributor_accounts d
 where exists(select 1 from public.users u where u.user_id=p_actor_id and u.is_active=true)
   and (public.receivables_is_admin(p_actor_id) or d.assigned_to=p_actor_id)
), receivable_money as (
 select r.distributor_id,r.receivable_id,r.lifecycle_status,r.bill_amount,
  coalesce(p.confirmed_paid_amount,0)::numeric(14,2) confirmed_paid_amount,
  (r.bill_amount-coalesce(p.confirmed_paid_amount,0))::numeric(14,2) outstanding_amount,
  coalesce(p.pending_payment_count,0)::integer pending_payment_count
 from allowed d
 join public.receivables r on r.distributor_id=d.distributor_id
 left join lateral (
   select coalesce(sum(rp.amount) filter(where rp.verification_status='confirmed' and rp.reversed_at is null),0)::numeric(14,2) confirmed_paid_amount,
     count(*) filter(where rp.verification_status='reported')::integer pending_payment_count
   from public.receivable_payments rp
   where rp.receivable_id=r.receivable_id
 ) p on true
), financial as (
 select d.distributor_id,
   count(r.receivable_id) filter(where r.lifecycle_status<>'cancelled')::integer active_receivable_count,
   coalesce(sum(r.bill_amount) filter(where r.lifecycle_status<>'cancelled'),0)::numeric(14,2) total_bill_amount,
   coalesce(sum(r.confirmed_paid_amount) filter(where r.lifecycle_status<>'cancelled'),0)::numeric(14,2) confirmed_collected_amount,
   coalesce(sum(r.outstanding_amount) filter(where r.lifecycle_status<>'cancelled'),0)::numeric(14,2) outstanding_amount,
   coalesce(sum(r.pending_payment_count) filter(where r.lifecycle_status<>'cancelled'),0)::integer pending_verification_count,
   coalesce(bool_or(r.lifecycle_status='disputed') filter(where r.lifecycle_status<>'cancelled'),false) has_disputed
 from allowed d
 left join receivable_money r on r.distributor_id=d.distributor_id
 group by d.distributor_id
), classified as (
 select d.*,f.active_receivable_count,f.total_bill_amount,f.confirmed_collected_amount,f.outstanding_amount,f.pending_verification_count,
 case when f.has_disputed then 'DISPUTED'
      when f.active_receivable_count=0 and d.billing_status='billed' then 'COLLECTION_SETUP_REQUIRED'
      when f.active_receivable_count=0 then 'NOT_BILLED'
      when f.outstanding_amount=0 then 'PAID'
      when f.confirmed_collected_amount>0 then 'PARTIALLY_PAID'
      else 'UNPAID' end collection_state,
 (d.billing_status='not_billed' and f.active_receivable_count>0) billing_collection_mismatch
 from allowed d join financial f using(distributor_id)
), filtered as (
 select * from classified where
 (p_search is null or btrim(p_search)='' or distributor_name ilike '%'||replace(replace(replace(btrim(p_search),'%',' '),'_',' '),',',' ')||'%' or distributor_reference ilike '%'||replace(replace(replace(btrim(p_search),'%',' '),'_',' '),',',' ')||'%') and
 (p_assigned_to is null or assigned_to=p_assigned_to) and
 (p_billing_filter is null or p_billing_filter='' or billing_status=p_billing_filter) and
 (p_payment_filter is null or p_payment_filter='' or collection_state=p_payment_filter or (p_payment_filter='NOT_PAID' and collection_state in ('UNPAID','PARTIALLY_PAID')))
), page_rows as (
 select * from filtered
 order by updated_at desc,distributor_id desc
 offset (select (page-1)*page_size from bounds)
 limit (select page_size from bounds)
)
select jsonb_build_object(
 'total',(select count(*) from filtered),
 'rows',coalesce((select jsonb_agg(to_jsonb(page_rows) order by updated_at desc,distributor_id desc) from page_rows),'[]'::jsonb)
)
$$;
revoke all on function public.distributor_financial_projection_v1(uuid,integer,integer,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.distributor_financial_projection_v1(uuid,integer,integer,text,uuid,text,text) to service_role;

create or replace function public.distributor_outstanding_receivables_v1(p_actor_id uuid,p_distributor_id uuid,p_limit integer default 50)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
with authorized as (
 select d.distributor_id
 from public.distributor_accounts d
 where d.distributor_id=p_distributor_id
   and exists(select 1 from public.users u where u.user_id=p_actor_id and u.is_active=true)
   and (public.receivables_is_admin(p_actor_id) or d.assigned_to=p_actor_id)
), exact_receivables as (
 select f.receivable_id,f.bill_reference,f.distributor_name,f.bill_amount,f.confirmed_paid_amount,f.outstanding_amount,
   f.bill_due_date,f.next_follow_up_date,f.assigned_to,f.lifecycle_status,f.payment_state,f.pending_payment_count,f.version
 from authorized d
 join public.receivables r on r.distributor_id=d.distributor_id
 join public.receivables_financial_read_v1 f on f.receivable_id=r.receivable_id
 where f.lifecycle_status<>'cancelled' and f.outstanding_amount>0
), bounded as (
 select * from exact_receivables
 order by bill_due_date,receivable_id
 limit least(greatest(coalesce(p_limit,50),1),50)
)
select jsonb_build_object(
 'total',(select count(*) from exact_receivables),
 'rows',coalesce((select jsonb_agg(to_jsonb(bounded) order by bill_due_date,receivable_id) from bounded),'[]'::jsonb)
)
$$;
revoke all on function public.distributor_outstanding_receivables_v1(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.distributor_outstanding_receivables_v1(uuid,uuid,integer) to service_role;

create function public.resolve_receivable_distributors_v1(p_rows jsonb)
returns table(row_number integer,distributor_id uuid,distributor_name text,distributor_reference text,resolution text)
language sql stable security definer set search_path=public,pg_temp as $$
with input as (select (value->>'row_number')::integer row_number,nullif(btrim(value->>'distributor_code'),'') distributor_code,btrim(value->>'distributor_name') distributor_name from jsonb_array_elements(p_rows)), matched as (
 select i.*,array_agg(d.distributor_id) filter(where d.distributor_id is not null) ids,array_agg(d.distributor_name) filter(where d.distributor_id is not null) names,array_agg(d.distributor_reference) filter(where d.distributor_id is not null) refs,array_agg(d.billing_status) filter(where d.distributor_id is not null) billing
 from input i left join public.distributor_accounts d on case when i.distributor_code is not null then lower(btrim(d.distributor_reference))=lower(i.distributor_code) else lower(btrim(d.distributor_name))=lower(i.distributor_name) end group by i.row_number,i.distributor_code,i.distributor_name
) select row_number,case when cardinality(ids)=1 then ids[1] end,case when cardinality(ids)=1 then names[1] end,case when cardinality(ids)=1 then refs[1] end,case when cardinality(ids)=1 and billing[1]<>'billed' then 'INVALID_DISTRIBUTOR_STATUS' when distributor_code is not null and cardinality(ids)=1 then 'RESOLVED' when distributor_code is not null then 'INVALID_DISTRIBUTOR' when cardinality(ids)=1 then 'RESOLVED' when cardinality(ids)>1 then 'AMBIGUOUS_DISTRIBUTOR' else 'INVALID_DISTRIBUTOR' end from matched
$$;
revoke all on function public.resolve_receivable_distributors_v1(jsonb) from public,anon,authenticated;
grant execute on function public.resolve_receivable_distributors_v1(jsonb) to service_role;

create or replace function public.receivables_admin_metrics_v1(p_actor_id uuid) returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
with collectible as (
 select * from public.receivables_financial_read_v1 where lifecycle_status<>'cancelled'
), month_bounds as (
 select date_trunc('month',(now() at time zone 'Asia/Kolkata'))::date start_date,
   date_trunc('month',(now() at time zone 'Asia/Kolkata')+interval '1 month')::date end_date
), payments as (
 select amount,payment_date from public.receivable_payments
 where verification_status='confirmed' and reversed_at is null
), collection_setup as (
 select count(*)::integer setup_required
 from public.distributor_accounts d
 where d.billing_status='billed'
   and not exists(select 1 from public.receivables r where r.distributor_id=d.distributor_id and r.lifecycle_status<>'cancelled')
)
select case when not public.receivables_is_admin(p_actor_id) then jsonb_build_object('success',false,'code','ADMIN_REQUIRED') else jsonb_build_object(
 'success',true,
 'total_outstanding',coalesce(sum(outstanding_amount),0)::text,
 'disputed_outstanding',coalesce(sum(outstanding_amount) filter(where lifecycle_status='disputed'),0)::text,
 'followups_due_today',count(*) filter(where alert_state in ('promise_due_today','followup_due_today')),
 'overdue_outstanding',coalesce(sum(outstanding_amount) filter(where alert_state in ('promise_overdue','followup_overdue')),0)::text,
 'awaiting_verification',coalesce(sum(pending_payment_count),0),
 'total_collected',coalesce((select sum(amount) from payments),0)::text,
 'collected_this_month',coalesce((select sum(p.amount) from payments p,month_bounds b where p.payment_date>=b.start_date and p.payment_date<b.end_date),0)::text,
 'collection_setup_required',(select setup_required from collection_setup),
 'aging',jsonb_build_object('Current',coalesce(sum(outstanding_amount) filter(where aging_bucket='Current'),0)::text,'1-7 days',coalesce(sum(outstanding_amount) filter(where aging_bucket='1-7 days'),0)::text,'8-15 days',coalesce(sum(outstanding_amount) filter(where aging_bucket='8-15 days'),0)::text,'16-30 days',coalesce(sum(outstanding_amount) filter(where aging_bucket='16-30 days'),0)::text,'31+ days',coalesce(sum(outstanding_amount) filter(where aging_bucket='31+ days'),0)::text)
 ) end from collectible
$$;

-- Owner postcheck: read-only proof that additive DDL created no business rows.
select jsonb_build_object('receivable_rows',(select count(*) from public.receivables),'receivable_bill_total',(select coalesce(sum(bill_amount),0) from public.receivables),'payment_rows',(select count(*) from public.receivable_payments),'effective_confirmed_collected',(select coalesce(sum(amount),0) from public.receivable_payments where verification_status='confirmed' and reversed_at is null),'effective_outstanding',(select coalesce(sum(outstanding_amount),0) from public.receivables_financial_read_v1 where lifecycle_status<>'cancelled')) as distributor_receivable_link_postcheck;
