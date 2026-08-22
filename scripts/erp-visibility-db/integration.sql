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
  v_result jsonb;
  v_rows jsonb;
begin
  if exists(select 1 from public.distributor_accounts where erp_id is not null) then
    raise exception 'MIGRATION_047_BACKFILLED_ERP';
  end if;

  insert into public.users(user_id,name,email,is_active) values
    (v_partner,'MARG Partner','marg-partner@example.com',true),
    (v_partner_two,'Tally Partner','tally-partner@example.com',true);
  insert into public.user_capabilities(user_id,capability_code) values
    (v_partner,'erp_partner_viewer'),(v_partner_two,'erp_partner_viewer');

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

  update public.distributor_accounts set erp_id=v_tally where distributor_id=v_distributor;
  insert into public.distributor_accounts(
    distributor_id,erp_id,distributor_name,distributor_reference,identity_key,assigned_to,
    installation_status,training_status,mapping_status,activity_status,billing_status,renewal_date,created_by
  ) values(
    '96000000-0000-4000-a000-000000000002',v_marg,'MARG Only','MARG-ONLY','code:marg-only',v_employee,
    'pending','pending','pending','not_applicable','not_billed',current_date+1,v_actor
  );
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
begin
  insert into public.distributor_accounts(
    distributor_id,erp_id,distributor_name,distributor_reference,identity_key,assigned_to,
    installation_status,training_status,mapping_status,activity_status,billing_status,renewal_date,created_by
  ) values(
    '96000000-0000-4000-a000-000000000003',null,'ERP Unset','ERP-UNSET','code:erp-unset',v_employee,
    'pending','pending','pending','not_applicable','not_billed',current_date+1,v_actor
  );
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

select 'Migration 047 ERP visibility integration passed' as result;
