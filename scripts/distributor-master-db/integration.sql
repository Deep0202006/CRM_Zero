\set ON_ERROR_STOP on

set role service_role;

do $$
declare
  v_result jsonb;
  v_distributors jsonb;
  v_receivables jsonb;
  v_payments jsonb;
begin
  v_distributors:=jsonb_build_array(jsonb_build_object(
    'rowNumber',2,
    'classification','NEW',
    'payload',jsonb_build_object(
      'distributor_id','96000000-0000-4000-a000-000000000001',
      'distributor_name','Master Fixture Distributor',
      'distributor_reference','MASTER-FIXTURE-1',
      'identity_key','code:master-fixture-1',
      'assigned_to','92000000-0000-4000-a000-000000000001',
      'installation_status','done','installation_completed_at',current_date,
      'training_status','done','training_completed_at',current_date,
      'mapping_status','done','mapped_at',current_date,
      'activity_status','active','billing_status','billed','billed_at',current_date,
      'bill_reference','OPS-MASTER-1','renewal_date',current_date+365
    )
  ));
  v_receivables:=jsonb_build_array(jsonb_build_object(
    'row_number',2,
    'receivable_id','97000000-0000-4000-a000-000000000001',
    'distributor_id','96000000-0000-4000-a000-000000000001',
    'distributor_name','Master Fixture Distributor','distributor_code','MASTER-FIXTURE-1',
    'bill_reference','MASTER-INV-1','contact_person','Fixture Owner','contact_phone','9999999999',
    'bill_amount','1000.00','bill_due_date',current_date,'next_follow_up_date',current_date+7,
    'assigned_to','92000000-0000-4000-a000-000000000001','notes','Master fixture bill'
  ));
  v_payments:=jsonb_build_array(jsonb_build_object(
    'row_number',2,
    'payment_id','98000000-0000-4000-a000-000000000001',
    'receivable_id','97000000-0000-4000-a000-000000000001',
    'import_key','FIXTURE-PAYMENT-1','amount','400.00','payment_date',current_date,
    'payment_mode','Bank','payment_reference','UTR-FIXTURE-1','note','Historical fixture payment'
  ));

  select public.import_distributor_master_v1(
    '99000000-0000-4000-a000-000000000001','91000000-0000-4000-a000-000000000001',
    repeat('a',64),repeat('0',64),repeat('b',64),'master-fixture.xlsx',v_distributors,v_receivables,v_payments
  ) into v_result;
  if not coalesce((v_result->>'success')::boolean,false)
     or (v_result#>>'{distributors,created_count}')::integer<>1
     or (v_result#>>'{receivables,created_count}')::integer<>1
     or (v_result#>>'{payments,created_count}')::integer<>1 then
    raise exception 'MASTER_SUCCESS_RESULT_INVALID: %',v_result;
  end if;
  if not exists(
    select 1 from public.distributor_accounts
    where distributor_id='96000000-0000-4000-a000-000000000001'
      and renewal_date=current_date+365 and billing_status='billed'
  ) then raise exception 'MASTER_DISTRIBUTOR_NOT_COMMITTED'; end if;
  if not exists(
    select 1 from public.receivables_financial_read_v1
    where receivable_id='97000000-0000-4000-a000-000000000001'
      and distributor_code='MASTER-FIXTURE-1'
      and bill_amount=1000.00 and confirmed_paid_amount=400.00
      and outstanding_amount=600.00 and payment_state='Partially Paid'
  ) then raise exception 'MASTER_FINANCIAL_AUTHORITY_INVALID'; end if;
  if not exists(
    select 1 from public.receivables
    where receivable_id='97000000-0000-4000-a000-000000000001'
      and distributor_id='96000000-0000-4000-a000-000000000001'
  ) then raise exception 'MASTER_CANONICAL_DISTRIBUTOR_LINK_INVALID'; end if;
  if not exists(
    select 1 from public.receivable_payments
    where payment_id='98000000-0000-4000-a000-000000000001'
      and receivable_id='97000000-0000-4000-a000-000000000001'
      and import_key='FIXTURE-PAYMENT-1'
      and verification_status='confirmed' and amount=400.00
  ) then raise exception 'MASTER_CONFIRMED_PAYMENT_INVALID'; end if;
end $$;

do $$
declare v_replay jsonb;
begin
  select public.import_distributor_master_v1(
    '99000000-0000-4000-a000-000000000001','91000000-0000-4000-a000-000000000001',
    repeat('a',64),repeat('0',64),repeat('b',64),'master-fixture.xlsx','[]'::jsonb,'[]'::jsonb,'[]'::jsonb
  ) into v_replay;
  if not coalesce((v_replay->>'success')::boolean,false) or not coalesce((v_replay->>'replayed')::boolean,false) then
    raise exception 'MASTER_REPLAY_INVALID: %',v_replay;
  end if;
end $$;

do $$
declare v_duplicate jsonb;
begin
  select public.import_distributor_master_v1(
    '99000000-0000-4000-a000-000000000003','91000000-0000-4000-a000-000000000001',
    repeat('e',64),repeat('7',64),repeat('f',64),'master-duplicate.xlsx','[]'::jsonb,'[]'::jsonb,
    jsonb_build_array(jsonb_build_object(
      'row_number',2,
      'payment_id','98000000-0000-4000-a000-000000000003',
      'receivable_id','97000000-0000-4000-a000-000000000001',
      'import_key','FIXTURE-PAYMENT-1','amount','400.00','payment_date',current_date,
      'payment_mode','Bank','payment_reference','UTR-FIXTURE-1','note','Historical fixture payment'
    ))
  ) into v_duplicate;
  if not coalesce((v_duplicate->>'success')::boolean,false)
     or (v_duplicate#>>'{payments,created_count}')::integer<>0
     or (v_duplicate#>>'{payments,duplicate_count}')::integer<>1
     or (select count(*) from public.receivable_payments where receivable_id='97000000-0000-4000-a000-000000000001')<>1 then
    raise exception 'MASTER_PAYMENT_IDEMPOTENCY_INVALID: %',v_duplicate;
  end if;
end $$;

do $$
declare v_failed jsonb;
begin
  select public.import_distributor_master_v1(
    '99000000-0000-4000-a000-000000000002','91000000-0000-4000-a000-000000000001',
    repeat('c',64),repeat('8',64),repeat('d',64),'master-rollback.xlsx',
    jsonb_build_array(jsonb_build_object(
      'rowNumber',2,'classification','NEW','payload',jsonb_build_object(
        'distributor_id','96000000-0000-4000-a000-000000000002',
        'distributor_name','Rollback Distributor','distributor_reference','MASTER-ROLLBACK-2',
        'identity_key','code:master-rollback-2','assigned_to','92000000-0000-4000-a000-000000000001',
        'installation_status','done','installation_completed_at',current_date,
        'training_status','done','training_completed_at',current_date,
        'mapping_status','done','mapped_at',current_date,'activity_status','active',
        'billing_status','billed','billed_at',current_date,'bill_reference','OPS-ROLLBACK-2',
        'renewal_date',current_date+365
      )
    )),
    jsonb_build_array(jsonb_build_object(
      'row_number',2,'receivable_id','97000000-0000-4000-a000-000000000002',
      'distributor_id','96000000-0000-4000-a000-000000000002',
      'distributor_name','Rollback Distributor','distributor_code','MASTER-ROLLBACK-2',
      'bill_reference','ROLLBACK-INV-2','contact_person','Fixture Owner','contact_phone','9999999999',
      'bill_amount','100.00','bill_due_date',current_date,'next_follow_up_date',current_date+7,
      'assigned_to','92000000-0000-4000-a000-000000000001','notes','Must roll back'
    )),
    jsonb_build_array(jsonb_build_object(
      'row_number',2,'payment_id','98000000-0000-4000-a000-000000000002',
      'receivable_id','97000000-0000-4000-a000-000000000002',
      'import_key','ROLLBACK-PAYMENT-2','amount','200.00','payment_date',current_date,
      'payment_mode','Bank','payment_reference','UTR-ROLLBACK-2','note','Must fail'
    ))
  ) into v_failed;
  if coalesce((v_failed->>'success')::boolean,false) or v_failed->>'code'<>'MASTER_PAYMENT_OVERPAYMENT' then
    raise exception 'MASTER_TYPED_FAILURE_INVALID: %',v_failed;
  end if;
  if exists(select 1 from public.distributor_accounts where distributor_id='96000000-0000-4000-a000-000000000002')
     or exists(select 1 from public.receivables where receivable_id='97000000-0000-4000-a000-000000000002')
     or exists(select 1 from public.receivable_payments where payment_id='98000000-0000-4000-a000-000000000002')
     or exists(select 1 from public.distributor_master_import_batches where operation_id='99000000-0000-4000-a000-000000000002') then
    raise exception 'MASTER_ATOMIC_ROLLBACK_INVALID';
  end if;
end $$;

reset role;
