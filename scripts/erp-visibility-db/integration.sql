\set ON_ERROR_STOP on

set role service_role;

do $$
declare
  v_actor constant uuid := '91000000-0000-4000-a000-000000000001';
  v_employee constant uuid := '92000000-0000-4000-a000-000000000001';
  v_partner constant uuid := '93000000-0000-4000-a000-000000000001';
  v_partner_two constant uuid := '93000000-0000-4000-a000-000000000002';
  v_distributor constant uuid := '96000000-0000-4000-a000-000000000001';
  v_marg uuid := md5('erp:marg')::uuid;
  v_tally uuid := md5('erp:tally prime')::uuid;
  v_before_receivables bigint;
  v_before_payments bigint;
  v_version bigint;
  v_event_count bigint;
  v_receipt_count bigint;
  v_result jsonb;
  v_rows jsonb;
  v_metrics_before jsonb;
  v_metrics_after jsonb;
  v_due_before jsonb;
  v_due_after jsonb;
begin
  if exists(select 1 from public.distributor_accounts where erp_id is not null) then
    raise exception 'MIGRATION_047_BACKFILLED_ERP';
  end if;

  insert into public.users(user_id,name,email,is_active) values
    (v_partner,'MARG Partner','marg-partner@example.com',true),
    (v_partner_two,'Tally Partner','tally-partner@example.com',true);
  insert into public.user_capabilities(user_id,capability_code) values
    (v_partner,'erp_partner_viewer'),(v_partner_two,'erp_partner_viewer'),(v_employee,'ret_support');

  select public.resolve_or_create_erp_system_v1(v_actor,'  MARG  ') into v_result;
  if not coalesce((v_result->>'success')::boolean,false) or (v_result->>'erp_id')::uuid<>v_marg then
    raise exception 'ERP_NORMALIZATION_FAILED: %',v_result;
  end if;
  select public.resolve_or_create_erp_system_v1(v_actor,'marg') into v_result;
  if coalesce((v_result->>'created')::boolean,true) or (select count(*) from public.erp_systems where erp_key='marg')<>1 then
    raise exception 'ERP_DEDUPE_FAILED: %',v_result;
  end if;
  perform public.resolve_or_create_erp_system_v1(v_actor,'Tally   Prime');

  select count(*) into v_before_receivables from public.receivables;
  select count(*) into v_before_payments from public.receivable_payments;
  select version into v_version from public.distributor_accounts where distributor_id=v_distributor;
  v_rows:=jsonb_build_array(jsonb_build_object(
    'rowNumber',2,'classification','UPDATE','payload',jsonb_build_object(
      'distributor_id',v_distributor,'expected_version',v_version,
      'erp_id',v_marg,'erp_name','MARG','distributor_name','Master Fixture Distributor',
      'distributor_reference','MASTER-FIXTURE-1','identity_key','code:master-fixture-1',
      'lead_id',null,'phone','','city','','assigned_to',v_employee,
      'installation_status','done','installation_completed_at',current_date,
      'training_status','done','training_completed_at',current_date,
      'mapping_status','done','mapped_at',current_date,'activity_status','active',
      'billing_status','billed','billed_at',current_date,'bill_reference','OPS-MASTER-1',
      'renewal_date','2027-04-01','note','ERP propagation proof'
    )
  ));
  select public.import_distributor_status_v1(
    '94000000-0000-4000-a000-000000000001',v_actor,repeat('4',64),'erp-proof.xlsx',v_rows
  ) into v_result;
  if not coalesce((v_result->>'success')::boolean,false) then raise exception 'ERP_IMPORT_FAILED: %',v_result; end if;
  if (select count(*) from public.receivables)<>v_before_receivables
     or (select count(*) from public.receivable_payments)<>v_before_payments then
    raise exception 'DISTRIBUTOR_IMPORT_MUTATED_FINANCIAL_AUTHORITY';
  end if;
  if not exists(select 1 from public.distributor_accounts where distributor_id=v_distributor and erp_id=v_marg and renewal_date='2027-04-01' and billing_status='billed') then
    raise exception 'DISTRIBUTOR_ERP_RENEWAL_NOT_COMMITTED';
  end if;
  select public.distributor_financial_projection_v2(v_actor,1,50,null,null,null,null,v_marg,false) into v_result;
  if v_result#>>'{rows,0,erp_name}'<>'MARG' or v_result#>>'{rows,0,collection_state}'<>'PARTIALLY_PAID' then
    raise exception 'DISTRIBUTOR_PROJECTION_ERP_MISMATCH: %',v_result;
  end if;
  select public.distributor_renewals_list_v2(v_actor,true,'all',1,50,v_marg,false) into v_result;
  if v_result#>>'{rows,0,erp_name}'<>'MARG' or v_result#>>'{rows,0,renewal_date}'<>'2027-04-01' then
    raise exception 'RENEWAL_PROJECTION_ERP_MISMATCH: %',v_result;
  end if;
  if not exists(select 1 from public.receivables_financial_read_v2 where receivable_id='97000000-0000-4000-a000-000000000001' and erp_name='MARG') then
    raise exception 'PAYMENT_COLLECTION_ERP_JOIN_FAILED';
  end if;

  perform public.apply_distributor_master_payments_v1(v_actor,jsonb_build_array(jsonb_build_object(
    'row_number',3,'payment_id','98000000-0000-4000-a000-000000000003',
    'receivable_id','97000000-0000-4000-a000-000000000001','import_key','FIXTURE-PAYMENT-REMAINDER',
    'amount','500.00','payment_date',current_date,'payment_mode','Bank',
    'payment_reference','UTR-FIXTURE-REMAINDER','note','Complete fixture payment'
  )));
  select version into v_version from public.distributor_accounts where distributor_id=v_distributor;
  select public.distributor_erp_payment_status_command_v1(
    '94000000-0000-4000-a000-000000000052',v_actor,'erp_payment',repeat('5',64),
    jsonb_build_object('distributor_id',v_distributor,'expected_version',v_version,'erp_payment_status','paid','note','ERP settled')
  ) into v_result;
  if not coalesce((v_result->>'success')::boolean,false)
     or not exists(select 1 from public.distributor_accounts where distributor_id=v_distributor and erp_payment_status='paid')
     or not exists(select 1 from public.distributor_status_events where distributor_id=v_distributor and event_type='erp_payment_status_updated')
     or not exists(select 1 from public.distributor_operation_receipts where operation_id='94000000-0000-4000-a000-000000000052') then
    raise exception 'ERP_PAYMENT_STATUS_COMMAND_FAILED: %',v_result;
  end if;
  select count(*) into v_event_count from public.distributor_status_events where distributor_id=v_distributor and event_type='erp_payment_status_updated';
  select count(*) into v_receipt_count from public.distributor_operation_receipts where operation_id='94000000-0000-4000-a000-000000000052';
  select public.distributor_erp_payment_status_command_v1(
    '94000000-0000-4000-a000-000000000052',v_actor,'erp_payment',repeat('5',64),
    jsonb_build_object('distributor_id',v_distributor,'expected_version',v_version,'erp_payment_status','paid','note','ERP settled')
  ) into v_result;
  if not coalesce((v_result->>'success')::boolean,false)
     or (select count(*) from public.distributor_status_events where distributor_id=v_distributor and event_type='erp_payment_status_updated')<>v_event_count
     or (select count(*) from public.distributor_operation_receipts where operation_id='94000000-0000-4000-a000-000000000052')<>v_receipt_count then
    raise exception 'ERP_PAYMENT_STATUS_REPLAY_NOT_IDEMPOTENT: %',v_result;
  end if;
  select public.distributor_erp_payment_status_command_v1(
    '94000000-0000-4000-a000-000000000052',v_actor,'erp_payment',repeat('7',64),
    jsonb_build_object('distributor_id',v_distributor,'expected_version',v_version,'erp_payment_status','paid')
  ) into v_result;
  if v_result->>'code'<>'DISTRIBUTOR_OPERATION_MISMATCH' then raise exception 'ERP_PAYMENT_STATUS_MISMATCH_REPLAY_ACCEPTED: %',v_result; end if;
  select public.distributor_erp_payment_status_command_v1(
    '94000000-0000-4000-a000-000000000054',v_actor,'erp_payment',repeat('8',64),
    jsonb_build_object('distributor_id',v_distributor,'expected_version',v_version,'erp_payment_status','not_paid')
  ) into v_result;
  if v_result->>'code'<>'DISTRIBUTOR_CONFLICT' then raise exception 'ERP_PAYMENT_STATUS_STALE_VERSION_ACCEPTED: %',v_result; end if;
  select version into v_version from public.distributor_accounts where distributor_id=v_distributor;
  select public.distributor_erp_payment_status_command_v1(
    '94000000-0000-4000-a000-000000000055',v_employee,'erp_payment',repeat('9',64),
    jsonb_build_object('distributor_id',v_distributor,'expected_version',v_version,'erp_payment_status','not_paid')
  ) into v_result;
  if v_result->>'code'<>'ADMIN_REQUIRED' then raise exception 'ERP_PAYMENT_STATUS_EMPLOYEE_WRITE_ACCEPTED: %',v_result; end if;

  update public.distributor_accounts set erp_id=v_tally where distributor_id=v_distributor;
  select public.distributor_renewal_metrics_v1(v_actor,true) into v_metrics_before;
  select public.distributor_renewals_due_v2(v_actor,true,50) into v_due_before;
  insert into public.distributor_accounts(
    distributor_id,erp_id,distributor_name,distributor_reference,identity_key,assigned_to,
    installation_status,training_status,mapping_status,activity_status,billing_status,renewal_date,created_by
  ) values(
    '96000000-0000-4000-a000-000000000002',v_marg,'MARG Only','MARG-ONLY','code:marg-only',v_employee,
    'pending','pending','pending','not_applicable','not_billed',current_date+1,v_actor
  );
  select public.distributor_renewal_metrics_v1(v_actor,true) into v_metrics_after;
  select public.distributor_renewals_due_v2(v_actor,true,50) into v_due_after;
  if v_metrics_after<>v_metrics_before or v_due_after<>v_due_before then raise exception 'UNBILLED_INTERNAL_RENEWAL_VISIBLE'; end if;
  select public.distributor_renewals_list_v2(v_actor,true,'all',1,50,v_marg,false) into v_result;
  if (v_result->>'total')::integer<>0 then raise exception 'UNBILLED_ADMIN_RENEWAL_VISIBLE: %',v_result; end if;
  select public.distributor_renewals_list_v2(v_employee,false,'all',1,50,v_marg,false) into v_result;
  if (v_result->>'total')::integer<>0 then raise exception 'UNBILLED_EMPLOYEE_RENEWAL_VISIBLE: %',v_result; end if;
  select public.set_erp_partner_scopes_v1(v_actor,v_partner,jsonb_build_array(v_marg)) into v_result;
  if not coalesce((v_result->>'success')::boolean,false) then raise exception 'ERP_SCOPE_SET_FAILED: %',v_result; end if;
  select public.erp_partner_distributors_v1(v_partner,null,null,1,50) into v_result;
  if (v_result->>'total')::integer<>1 or v_result#>>'{rows,0,erp_name}'<>'MARG' then raise exception 'ERP_SINGLE_SCOPE_LEAK: %',v_result; end if;
  if (v_result#>'{rows,0}') ?| array['assigned_to','lead_id','bill_amount','outstanding_amount','receivable_id','notes'] then
    raise exception 'ERP_EXTERNAL_PROJECTION_EXPOSED_SENSITIVE_FIELDS: %',v_result#>'{rows,0}';
  end if;
  select public.set_erp_partner_scopes_v1(v_actor,v_partner,jsonb_build_array(v_marg,v_tally)) into v_result;
  select public.erp_partner_distributors_v1(v_partner,null,null,1,50) into v_result;
  if (v_result->>'total')::integer<>2 then raise exception 'ERP_MULTI_SCOPE_UNION_FAILED: %',v_result; end if;
  if not exists(select 1 from jsonb_array_elements(v_result->'rows') r where r->>'distributor_id'=v_distributor::text and r->>'erp_payment_status'='paid') then
    raise exception 'ERP_PAYMENT_STATUS_NOT_VISIBLE_TO_SCOPED_PARTNER: %',v_result;
  end if;
  select public.erp_partner_renewals_v1(v_partner,v_marg,'all',1,50) into v_result;
  if (v_result->>'total')::integer<>0 then raise exception 'ERP_UNBILLED_RENEWAL_VISIBLE: %',v_result; end if;
  insert into public.receivables(
    receivable_id,distributor_id,bill_reference,bill_reference_key,distributor_name,distributor_identity_key,
    distributor_code,contact_person,bill_amount,bill_due_date,next_follow_up_date,assigned_to,source,created_by
  ) values(
    '97000000-0000-4000-a000-000000000052','96000000-0000-4000-a000-000000000002','ERP-PENDING','erp-pending','MARG Only','code:marg-only',
    'MARG-ONLY','A',100.00,current_date,current_date,v_employee,'manual',v_actor
  );
  insert into public.receivable_payments(payment_id,receivable_id,amount,payment_date,reported_by,verification_status)
  values('98000000-0000-4000-a000-000000000052','97000000-0000-4000-a000-000000000052',100.00,current_date,v_employee,'reported');
  select public.distributor_financial_projection_v2(
    v_actor,1,50,'MARG Only',v_employee,'NOT_PAID','not_billed',v_marg,false,'pending','pending','pending','not_applicable','due_soon'
  ) into v_result;
  if (v_result->>'total')::integer<>0 then
    raise exception 'UNBILLED_INTERNAL_DUE_SOON_VISIBLE: %',v_result;
  end if;
  select version into v_version from public.distributor_accounts where distributor_id='96000000-0000-4000-a000-000000000002';
  select public.distributor_erp_payment_status_command_v1(
    '94000000-0000-4000-a000-000000000053',v_actor,'erp_payment',repeat('6',64),
    jsonb_build_object('distributor_id','96000000-0000-4000-a000-000000000002','expected_version',v_version,'erp_payment_status','not_paid')
  ) into v_result;
  if v_result->>'code'<>'ERP_PAYMENT_STATUS_REQUIRES_BILLED' then raise exception 'ERP_PAYMENT_STATUS_ACCEPTED_NOT_BILLED_REPORTED_PAYMENT: %',v_result; end if;
  update public.receivable_payments set verification_status='confirmed',verified_by=v_actor,verified_at=now()
  where payment_id='98000000-0000-4000-a000-000000000052';
  select public.distributor_erp_payment_status_command_v1(
    '94000000-0000-4000-a000-000000000056',v_actor,'erp_payment',repeat('a',64),
    jsonb_build_object('distributor_id','96000000-0000-4000-a000-000000000002','expected_version',v_version,'erp_payment_status','not_paid')
  ) into v_result;
  if v_result->>'code'<>'ERP_PAYMENT_STATUS_REQUIRES_BILLED' then raise exception 'ERP_PAYMENT_STATUS_ACCEPTED_NOT_BILLED_CONFIRMED_PAYMENT: %',v_result; end if;
  update public.receivable_payments set verification_status='reversed',reversed_by=v_actor,reversed_at=now(),reversal_reason='Integration reversal'
  where payment_id='98000000-0000-4000-a000-000000000052';
  select version into v_version from public.distributor_accounts where distributor_id='96000000-0000-4000-a000-000000000002';
  select public.distributor_erp_payment_status_command_v1(
    '94000000-0000-4000-a000-000000000057',v_actor,'erp_payment',repeat('b',64),
    jsonb_build_object('distributor_id','96000000-0000-4000-a000-000000000002','expected_version',v_version,'erp_payment_status','paid')
  ) into v_result;
  if v_result->>'code'<>'ERP_PAYMENT_STATUS_REQUIRES_BILLED' then raise exception 'ERP_PAYMENT_STATUS_ACCEPTED_NOT_BILLED_REVERSED_PAYMENT: %',v_result; end if;
  insert into public.receivable_payments(payment_id,receivable_id,amount,payment_date,reported_by,verification_status,verified_by,verified_at)
  values('98000000-0000-4000-a000-000000000053','97000000-0000-4000-a000-000000000052',100.00,current_date,v_actor,'confirmed',v_actor,now());
  update public.receivables set lifecycle_status='disputed' where receivable_id='97000000-0000-4000-a000-000000000052';
  select public.distributor_erp_payment_status_command_v1(
    '94000000-0000-4000-a000-000000000058',v_actor,'erp_payment',repeat('c',64),
    jsonb_build_object('distributor_id','96000000-0000-4000-a000-000000000002','expected_version',v_version,'erp_payment_status','paid')
  ) into v_result;
  if v_result->>'code'<>'ERP_PAYMENT_STATUS_REQUIRES_BILLED' then raise exception 'ERP_PAYMENT_STATUS_ACCEPTED_NOT_BILLED_DISPUTED_RECEIVABLE: %',v_result; end if;

  begin
    insert into public.user_capabilities(user_id,capability_code) values(v_partner,'tech_support');
    raise exception 'ERP_INTERNAL_CAPABILITY_MIX_ALLOWED';
  exception when sqlstate 'ZD201' then null; end;
  begin
    insert into public.user_capabilities(user_id,capability_code) values(v_employee,'erp_partner_viewer');
    raise exception 'ASSIGNED_EMPLOYEE_CONVERSION_ALLOWED';
  exception when sqlstate 'ZD202' then null; end;
  begin
    update public.receivables
    set assigned_to=v_partner
    where receivable_id='97000000-0000-4000-a000-000000000001';
    raise exception 'ERP_PARTNER_RECEIVABLE_ASSIGNMENT_ALLOWED';
  exception when sqlstate 'ZD001' then null; end;
  if public.is_operational_employee_v1(v_partner) then raise exception 'ERP_PARTNER_IS_OPERATIONAL_EMPLOYEE'; end if;
  if has_table_privilege('authenticated','public.erp_partner_scopes','select')
     or has_table_privilege('authenticated','public.erp_systems','select') then raise exception 'ERP_TABLE_BROWSER_ACCESS_ALLOWED'; end if;
end $$;

do $$
declare
  v_actor constant uuid := '91000000-0000-4000-a000-000000000001';
  v_employee constant uuid := '92000000-0000-4000-a000-000000000001';
  v_marg uuid := md5('erp:marg')::uuid;
  v_tally uuid := md5('erp:tally prime')::uuid;
  v_metrics jsonb;
  v_total bigint;
  v_before bigint;
  v_after bigint;
  v_result jsonb;
begin
  insert into public.distributor_accounts(
    distributor_id,erp_id,distributor_name,distributor_reference,identity_key,assigned_to,
    installation_status,training_status,mapping_status,activity_status,billing_status,renewal_date,created_by
  ) values(
    '96000000-0000-4000-a000-000000000003',null,'ERP Unset','ERP-UNSET','code:erp-unset',v_employee,
    'pending','pending','pending','not_applicable','not_billed',current_date+1,v_actor
  );
  select public.distributor_financial_projection_v2(v_actor,1,50,null,null,null,null,null,true,null,null,null,null,null) into v_result;
  if (v_result->>'total')::bigint<>(select count(*) from public.distributor_accounts where erp_id is null)
     or exists(select 1 from jsonb_array_elements(v_result->'rows') row where row->>'erp_id' is not null) then
    raise exception 'ERP_UNSET_FILTER_LEAK: %',v_result;
  end if;
  select count(*) into v_before from public.distributor_accounts;
  select public.distributor_status_metrics_v1(v_actor,true) into v_metrics;
  select count(*) into v_after from public.distributor_accounts;
  if v_before<>v_after then raise exception 'ERP_METRICS_MUTATED_DISTRIBUTOR_ACCOUNTS'; end if;
  select count(*) into v_total from public.distributor_accounts;
  if (v_metrics->>'total')::bigint<>v_total then raise exception 'ERP_METRICS_TOTAL_MISMATCH: %',v_metrics; end if;
  if not (v_metrics ?& array['total','installation_pending','training_pending','installation_training_done','mapped','active','inactive','billed']) then raise exception 'ERP_METRICS_LEGACY_KEYS_MISSING: %',v_metrics; end if;
  if (select coalesce(sum((value->>'count')::bigint),0) from jsonb_array_elements(v_metrics->'erp_distribution'))<>v_total then raise exception 'ERP_DISTRIBUTION_NOT_RECONCILED: %',v_metrics; end if;
  if coalesce((select (value->>'count')::bigint from jsonb_array_elements(v_metrics->'erp_distribution') where value->>'erp_id'=v_marg::text),0)<>(select count(*) from public.distributor_accounts where erp_id=v_marg) then raise exception 'ERP_MARG_COUNT_MISMATCH: %',v_metrics; end if;
  if coalesce((select (value->>'count')::bigint from jsonb_array_elements(v_metrics->'erp_distribution') where value->>'erp_id'=v_tally::text),0)<>(select count(*) from public.distributor_accounts where erp_id=v_tally) then raise exception 'ERP_TALLY_COUNT_MISMATCH: %',v_metrics; end if;
  if coalesce((select (value->>'count')::bigint from jsonb_array_elements(v_metrics->'erp_distribution') where value->>'erp_id' is null),0)<>(select count(*) from public.distributor_accounts where erp_id is null) then raise exception 'ERP_UNSET_COUNT_MISMATCH: %',v_metrics; end if;
  select public.distributor_status_metrics_v1(v_employee,false) into v_metrics;
  if (v_metrics->>'total')::bigint<>(select count(*) from public.distributor_accounts where assigned_to=v_employee) then raise exception 'ERP_METRICS_EMPLOYEE_SCOPE_CHANGED: %',v_metrics; end if;
  select public.distributor_status_metrics_v1(v_employee,true) into v_metrics;
  if (v_metrics->>'total')::bigint<>0 then raise exception 'ERP_METRICS_NONADMIN_ADMIN_SCOPE_ALLOWED: %',v_metrics; end if;
end $$;

do $$
declare
  v_actor constant uuid := '91000000-0000-4000-a000-000000000001';
  v_employee constant uuid := '92000000-0000-4000-a000-000000000001';
  v_employee_two constant uuid := '92000000-0000-4000-a000-000000000002';
  v_partner constant uuid := '93000000-0000-4000-a000-000000000001';
  v_partner_two constant uuid := '93000000-0000-4000-a000-000000000002';
  v_marg uuid := md5('erp:marg')::uuid;
  v_tally uuid := md5('erp:tally prime')::uuid;
  v_zoho uuid;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_result jsonb;
  v_baseline jsonb;
  v_after jsonb;
  v_renewals jsonb;
  v_before integer;
  v_version bigint;
begin
  insert into public.users(user_id,name,email,is_active) values(v_employee_two,'Second Employee','second-employee@example.com',true);
  insert into public.user_capabilities(user_id,capability_code) values(v_employee_two,'tech_support'),(v_employee_two,'ret_support');
  select (public.resolve_or_create_erp_system_v1(v_actor,'Zoho')->>'erp_id')::uuid into v_zoho;

  insert into public.distributor_accounts(
    distributor_id,erp_id,distributor_name,distributor_reference,identity_key,assigned_to,
    installation_status,training_status,mapping_status,activity_status,billing_status,erp_payment_status,renewal_date,created_by
  )
  select md5('erp-kpi-'||i)::uuid,v_marg,'ERP KPI '||lpad(i::text,2,'0'),'ERP-KPI-'||i,'code:erp-kpi-'||i,v_employee,
    case when i<=10 then 'pending' else 'done' end,
    case when i<=20 then 'pending' else 'done' end,
    case when i>20 and i%2=0 then 'done' else 'pending' end,
    case when i<=20 then 'not_applicable' when i<=55 then 'active' else 'inactive' end,
    case when i<=15 then 'not_billed' else 'billed' end,
    case when i between 16 and 22 then 'paid' else null end,
    case when i<=5 then v_today+1 when i between 16 and 20 then v_today+1 when i between 21 and 25 then v_today-1 else v_today+10 end,
    v_actor
  from generate_series(1,60)i;
  insert into public.distributor_accounts(
    distributor_id,erp_id,distributor_name,distributor_reference,identity_key,assigned_to,
    installation_status,training_status,mapping_status,activity_status,billing_status,renewal_date,created_by
  ) values(md5('erp-kpi-unscoped')::uuid,v_zoho,'Unscoped ERP KPI','ERP-KPI-UNSCOPED','code:erp-kpi-unscoped',v_employee,
    'done','done','pending','active','billed',v_today+1,v_actor);

  select public.set_erp_partner_scopes_v1(v_actor,v_partner,jsonb_build_array(v_marg,v_tally)) into v_result;
  select public.erp_partner_distributors_v2(v_partner,null,null,1,50,null,null,null,null,null,null) into v_baseline;
  if (v_baseline#>>'{metrics,total}')::integer<61 or jsonb_array_length(v_baseline->'rows')<>50 or (v_baseline->>'total')::integer<>(v_baseline#>>'{metrics,total}')::integer then
    raise exception 'ERP_FULL_SCOPE_METRICS_NOT_BEFORE_PAGINATION: %',v_baseline;
  end if;
  if (v_baseline#>>'{metrics,total}')::integer<>(select count(*) from public.distributor_accounts where erp_id in(v_marg,v_tally)) then
    raise exception 'ERP_UNSCOPED_METRICS_LEAK: %',v_baseline;
  end if;
  select public.erp_partner_distributors_v2(v_partner,v_marg,'NO MATCH',2,7,'done','pending',null,null,null,null) into v_result;
  if v_result->'metrics'<>((select public.erp_partner_distributors_v2(v_partner,v_marg,null,1,50,null,null,null,null,null,null))->'metrics')
     or (v_result->>'total')::integer<>0 or jsonb_array_length(v_result->'rows')<>0 then
    raise exception 'ERP_SEARCH_FILTER_OR_PAGE_CORRUPTED_METRICS: %',v_result;
  end if;
  if (v_baseline#>>'{metrics,installation_pending}')::integer<>(select count(*) from public.distributor_accounts where erp_id in(v_marg,v_tally) and installation_status='pending')
     or (v_baseline#>>'{metrics,training_pending}')::integer<>(select count(*) from public.distributor_accounts where erp_id in(v_marg,v_tally) and installation_status='done' and training_status='pending')
     or (v_baseline#>>'{metrics,not_billed}')::integer<>(select count(*) from public.distributor_accounts where erp_id in(v_marg,v_tally) and billing_status='not_billed')
     or (v_baseline#>>'{metrics,active}')::integer<>(select count(*) from public.distributor_accounts where erp_id in(v_marg,v_tally) and activity_status='active')
     or (v_baseline#>>'{metrics,billed}')::integer<>(select count(*) from public.distributor_accounts where erp_id in(v_marg,v_tally) and billing_status='billed')
     or (v_baseline#>>'{metrics,paid}')::integer<>(select count(*) from public.distributor_accounts where erp_id in(v_marg,v_tally) and erp_payment_status='paid')
     or (v_baseline#>>'{metrics,renewal_due_soon}')::integer<>(select count(*) from public.distributor_accounts where erp_id in(v_marg,v_tally) and billing_status='billed' and renewal_date between v_today and v_today+2)
     or (v_baseline#>>'{metrics,renewal_overdue}')::integer<>(select count(*) from public.distributor_accounts where erp_id in(v_marg,v_tally) and billing_status='billed' and renewal_date<v_today) then
    raise exception 'ERP_EXACT_METRIC_SEMANTICS_FAILED: %',v_baseline;
  end if;
  select public.erp_partner_distributors_v2(v_partner,v_marg,null,1,50,null,null,null,'active',null,null) into v_result;
  if (v_result->>'total')::integer<>(select count(*) from public.distributor_accounts where erp_id=v_marg and activity_status='active')
     or jsonb_array_length(v_result->'rows')<>least(50,(v_result->>'total')::integer) then
    raise exception 'ERP_FILTER_NOT_BEFORE_PAGINATION: %',v_result;
  end if;
  select public.erp_partner_distributors_v2(v_partner,v_marg,null,1,50,null,null,null,null,null,'due_soon') into v_result;
  select public.erp_partner_renewals_v1(v_partner,v_marg,'all',1,50) into v_renewals;
  if (v_result->>'total')::integer<>(v_renewals#>>'{metrics,today}')::integer+(v_renewals#>>'{metrics,tomorrow}')::integer+(v_renewals#>>'{metrics,in_two_days}')::integer then
    raise exception 'ERP_DUE_SOON_RENEWAL_RECONCILIATION_FAILED: % / %',v_result,v_renewals;
  end if;
  select public.erp_partner_distributors_v2(v_partner,v_marg,null,1,50,null,null,null,null,null,'overdue') into v_result;
  if (v_result->>'total')::integer<>(v_renewals#>>'{metrics,overdue}')::integer then raise exception 'ERP_OVERDUE_RENEWAL_RECONCILIATION_FAILED'; end if;
  if exists(select 1 from jsonb_array_elements(v_result->'rows')r where r->>'billing_status'<>'billed') then raise exception 'ERP_UNBILLED_OVERDUE_VISIBLE'; end if;

  select (public.erp_partner_distributors_v2(v_partner,v_tally,null,1,50,null,null,null,null,null,null)#>>'{metrics,paid}')::integer into v_before;
  select version into v_version from public.distributor_accounts where distributor_id='96000000-0000-4000-a000-000000000001';
  select public.distributor_erp_payment_status_command_v1(gen_random_uuid(),v_actor,'erp_payment',repeat('1',64),jsonb_build_object(
    'distributor_id','96000000-0000-4000-a000-000000000001','expected_version',v_version,'erp_payment_status','not_paid','note','canonical read proof'
  )) into v_result;
  if not coalesce((v_result->>'success')::boolean,false) or (public.erp_partner_distributors_v2(v_partner,v_tally,null,1,50,null,null,null,null,null,null)#>>'{metrics,paid}')::integer<>v_before-1 then
    raise exception 'ERP_PAID_CANONICAL_READ_DID_NOT_DECREASE: %',v_result;
  end if;

  select public.erp_partner_distributors_v2(v_partner,v_marg,null,1,50,null,null,null,null,null,null) into v_baseline;
  update public.distributor_accounts set billing_status='billed' where distributor_id=md5('erp-kpi-5')::uuid;
  select public.erp_partner_distributors_v2(v_partner,v_marg,null,1,50,null,null,null,null,null,null) into v_after;
  if (v_after#>>'{metrics,not_billed}')::integer<>(v_baseline#>>'{metrics,not_billed}')::integer-1
     or (v_after#>>'{metrics,billed}')::integer<>(v_baseline#>>'{metrics,billed}')::integer+1
     or (v_after#>>'{metrics,renewal_due_soon}')::integer<>(v_baseline#>>'{metrics,renewal_due_soon}')::integer+1 then
    raise exception 'ERP_BILLING_CANONICAL_READ_DID_NOT_RECONCILE: % / %',v_baseline,v_after;
  end if;

  select public.set_erp_partner_scopes_v1(v_actor,v_partner,jsonb_build_array(v_marg)) into v_result;
  select public.set_erp_partner_scopes_v1(v_actor,v_partner_two,jsonb_build_array(v_tally)) into v_result;
  if (public.erp_partner_distributors_v2(v_partner,v_marg,'ERP KPI 30',1,50,null,null,null,null,null,null)->>'total')::integer<>1 then raise exception 'ERP_A_INITIAL_VISIBILITY_MISSING'; end if;
  update public.distributor_accounts set erp_id=v_tally where distributor_id=md5('erp-kpi-30')::uuid;
  if (public.erp_partner_distributors_v2(v_partner,v_marg,'ERP KPI 30',1,50,null,null,null,null,null,null)->>'total')::integer<>0
     or (public.erp_partner_distributors_v2(v_partner_two,v_tally,'ERP KPI 30',1,50,null,null,null,null,null,null)->>'total')::integer<>1 then
    raise exception 'ERP_REASSIGNMENT_VISIBILITY_STALE';
  end if;
  if (public.distributor_financial_projection_v2(v_employee,1,50,'ERP KPI 31',null,null,null,null,false,null,null,null,null,null)->>'total')::integer<>1 then raise exception 'EMPLOYEE_INITIAL_VISIBILITY_MISSING'; end if;
  update public.distributor_accounts set assigned_to=v_employee_two where distributor_id=md5('erp-kpi-31')::uuid;
  if (public.distributor_financial_projection_v2(v_employee,1,50,'ERP KPI 31',null,null,null,null,false,null,null,null,null,null)->>'total')::integer<>0
     or (public.distributor_financial_projection_v2(v_employee_two,1,50,'ERP KPI 31',null,null,null,null,false,null,null,null,null,null)->>'total')::integer<>1 then
    raise exception 'EMPLOYEE_REASSIGNMENT_VISIBILITY_STALE';
  end if;
end $$;

reset role;
set role authenticated;
do $$ begin
  begin
    perform public.distributor_erp_payment_status_command_v1(
      '94000000-0000-4000-a000-000000000059','91000000-0000-4000-a000-000000000001','erp_payment',repeat('d',64),'{}'
    );
    raise exception 'AUTHENTICATED_ERP_PAYMENT_COMMAND_ALLOWED';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set role anon;
do $$ begin
  begin
    perform public.distributor_erp_payment_status_command_v1(
      '94000000-0000-4000-a000-000000000060','91000000-0000-4000-a000-000000000001','erp_payment',repeat('e',64),'{}'
    );
    raise exception 'ANON_ERP_PAYMENT_COMMAND_ALLOWED';
  exception when insufficient_privilege then null; end;
end $$;
reset role;

select 'Migration 047 ERP visibility integration passed' as result;
