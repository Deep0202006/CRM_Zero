\set ON_ERROR_STOP on
do $$
declare
  v_ret uuid := '00000000-0000-4000-8000-000000000001';
  v_dist uuid := '00000000-0000-4000-8000-000000000002';
  v_viewer uuid := '00000000-0000-4000-8000-000000000003';
  v_result jsonb;
  v_intelligence jsonb;
  v_erp_before bigint;
  v_visit_before bigint;
  v_category_count bigint;
  v_share numeric;
begin
  -- Migration 048 is zero-backfill: the one historical visit remains Unknown/Not captured.
  if (select count(*) from public.field_visits where erp_id is null and erp_usage_state is null) <> 1 then
    raise exception 'ERP_HISTORICAL_NULL_NOT_PRESERVED';
  end if;

  select count(*) into v_erp_before from public.erp_systems;
  select public.confirm_field_visit_erp_v1(v_ret,jsonb_build_object(
    'visit_id','00000000-0000-4000-8000-000000000023','lead_id','missing-erp-retailer','visit_date','2026-08-12',
    'check_in_time','2026-08-12T04:29:00Z','visit_outcome','interested','segment_type','Retailer','address','ERP test address',
    'pincode','110001','created_at','2026-08-12T04:29:00Z','updated_at','2026-08-12T04:29:00Z')) into v_result;
  if v_result->>'code' <> 'ERP_REQUIRED' or exists(select 1 from public.field_visits where visit_id='00000000-0000-4000-8000-000000000023') then
    raise exception 'MISSING_ERP_OBSERVATION_ACCEPTED: %',v_result;
  end if;

  -- MARG, Marg and surrounding/internal spaces resolve to one canonical ERP identity.
  select public.confirm_field_visit_erp_v1(v_ret,jsonb_build_object(
    'visit_id','00000000-0000-4000-8000-000000000024','lead_id','erp-retailer','visit_date','2026-08-12',
    'check_in_time','2026-08-12T04:30:00Z','visit_outcome','interested','segment_type','Retailer','address','ERP test address',
    'pincode','110001','created_at','2026-08-12T04:30:00Z','updated_at','2026-08-12T04:30:00Z','erp_usage_state','erp','erp_name_input',' MARG ')) into v_result;
  if not coalesce((v_result->>'success')::boolean,false) then raise exception 'MARG_CREATE_FAILED: %',v_result; end if;
  select public.confirm_field_visit_erp_v1(v_ret,jsonb_build_object(
    'visit_id','00000000-0000-4000-8000-000000000027','lead_id','marg-second','visit_date','2026-08-12',
    'check_in_time','2026-08-12T04:31:00Z','visit_outcome','interested','segment_type','Retailer','address','ERP test address',
    'pincode','110001','created_at','2026-08-12T04:31:00Z','updated_at','2026-08-12T04:31:00Z','erp_usage_state','erp','erp_name_input','  Marg  ')) into v_result;
  if not coalesce((v_result->>'success')::boolean,false) or (select count(*) from public.erp_systems where erp_key='marg') <> 1
    or (select count(distinct erp_id) from public.field_visits where lead_id in ('erp-retailer','marg-second')) <> 1 then
    raise exception 'ERP_NORMALIZATION_NOT_CANONICAL: %',v_result;
  end if;

  -- Explicit None is captured but creates no ERP dimension row.
  select count(*) into v_erp_before from public.erp_systems;
  select public.confirm_field_visit_erp_v1(v_ret,jsonb_build_object(
    'visit_id','00000000-0000-4000-8000-000000000025','lead_id','none-retailer','visit_date','2026-08-12',
    'check_in_time','2026-08-12T04:32:00Z','visit_outcome','interested','segment_type','Retailer','address','ERP test address',
    'pincode','110001','created_at','2026-08-12T04:32:00Z','updated_at','2026-08-12T04:32:00Z','erp_usage_state','none')) into v_result;
  if not coalesce((v_result->>'success')::boolean,false) or (select count(*) from public.erp_systems) <> v_erp_before
    or not exists(select 1 from public.field_visits where visit_id='00000000-0000-4000-8000-000000000025' and erp_usage_state='none' and erp_id is null) then
    raise exception 'EXPLICIT_NONE_CONTRACT_FAILED: %',v_result;
  end if;

  -- One free-typed custom ERP is created exactly once; same visit retry is idempotent.
  select public.confirm_field_visit_erp_v1(v_ret,jsonb_build_object(
    'visit_id','00000000-0000-4000-8000-000000000028','lead_id','custom-retailer','visit_date','2026-08-12',
    'check_in_time','2026-08-12T04:33:00Z','visit_outcome','interested','segment_type','Retailer','address','ERP test address',
    'pincode','110001','created_at','2026-08-12T04:33:00Z','updated_at','2026-08-12T04:33:00Z','erp_usage_state','erp','erp_name_input','Custom ERP')) into v_result;
  if not coalesce((v_result->>'success')::boolean,false) or (select count(*) from public.erp_systems where erp_key='custom erp') <> 1 then
    raise exception 'CUSTOM_ERP_CREATE_FAILED: %',v_result;
  end if;
  select count(*) into v_erp_before from public.erp_systems;
  select count(*) into v_visit_before from public.field_visits;
  select public.confirm_field_visit_erp_v1(v_ret,jsonb_build_object(
    'visit_id','00000000-0000-4000-8000-000000000028','lead_id','custom-retailer','visit_date','2026-08-12',
    'check_in_time','2026-08-12T04:33:00Z','visit_outcome','interested','segment_type','Retailer','address','ERP test address',
    'pincode','110001','created_at','2026-08-12T04:33:00Z','updated_at','2026-08-12T04:33:00Z','erp_usage_state','erp','erp_name_input',' custom   erp ')) into v_result;
  if not coalesce((v_result->>'already_confirmed')::boolean,false) or (select count(*) from public.erp_systems) <> v_erp_before
    or (select count(*) from public.field_visits) <> v_visit_before then raise exception 'RETRY_NOT_IDEMPOTENT: %',v_result; end if;

  -- A failed visit insert rolls back the newly resolved ERP in the same transaction.
  begin
    perform public.confirm_field_visit_erp_v1(v_ret,jsonb_build_object(
      'visit_id','00000000-0000-4000-8000-000000000026','lead_id','rollback-retailer','visit_date','2026-08-12',
      'check_in_time','2026-08-12T04:34:00Z','visit_outcome','invalid-outcome','segment_type','Retailer','address','ERP test address',
      'pincode','110001','created_at','2026-08-12T04:34:00Z','updated_at','2026-08-12T04:34:00Z','erp_usage_state','erp','erp_name_input','Rollback ERP'));
    raise exception 'ERP_CONFIRMATION_SHOULD_HAVE_FAILED';
  exception when check_violation then null;
  end;
  if exists(select 1 from public.erp_systems where erp_key='rollback erp')
    or exists(select 1 from public.field_visits where visit_id='00000000-0000-4000-8000-000000000026') then
    raise exception 'ERP_CONFIRMATION_NOT_ATOMIC';
  end if;

  -- Capability matrix: each field role is segment-bounded; ERP viewer has no write authority.
  select public.confirm_field_visit_erp_v1(v_ret,jsonb_build_object('visit_id','00000000-0000-4000-8000-000000000029','lead_id','ret-denied-dist','visit_date','2026-08-12','check_in_time','2026-08-12T04:35:00Z','visit_outcome','interested','segment_type','Distributor','created_at','2026-08-12T04:35:00Z','updated_at','2026-08-12T04:35:00Z','erp_usage_state','none')) into v_result;
  if v_result->>'code' <> 'CAPABILITY_MISMATCH' then raise exception 'FIELD_RET_DISTRIBUTOR_ALLOWED: %',v_result; end if;
  select public.confirm_field_visit_erp_v1(v_dist,jsonb_build_object('visit_id','00000000-0000-4000-8000-000000000030','lead_id','dist-business','visit_date','2026-08-12','check_in_time','2026-08-12T04:36:00Z','visit_outcome','interested','segment_type','Distributor','address','ERP test address','pincode','110001','created_at','2026-08-12T04:36:00Z','updated_at','2026-08-12T04:36:00Z','erp_usage_state','erp','erp_name_input','marg')) into v_result;
  if not coalesce((v_result->>'success')::boolean,false) then raise exception 'FIELD_DIST_DISTRIBUTOR_DENIED: %',v_result; end if;
  select public.confirm_field_visit_erp_v1(v_dist,jsonb_build_object('visit_id','00000000-0000-4000-8000-000000000031','lead_id','dist-denied-ret','visit_date','2026-08-12','check_in_time','2026-08-12T04:37:00Z','visit_outcome','interested','segment_type','Retailer','created_at','2026-08-12T04:37:00Z','updated_at','2026-08-12T04:37:00Z','erp_usage_state','none')) into v_result;
  if v_result->>'code' <> 'CAPABILITY_MISMATCH' then raise exception 'FIELD_DIST_RETAILER_ALLOWED: %',v_result; end if;
  select public.confirm_field_visit_erp_v1(v_viewer,jsonb_build_object('visit_id','00000000-0000-4000-8000-000000000032','lead_id','viewer-denied','visit_date','2026-08-12','check_in_time','2026-08-12T04:38:00Z','visit_outcome','interested','segment_type','Retailer','created_at','2026-08-12T04:38:00Z','updated_at','2026-08-12T04:38:00Z','erp_usage_state','none')) into v_result;
  if v_result->>'code' <> 'CAPABILITY_MISMATCH' then raise exception 'ERP_PARTNER_VIEWER_WRITE_ALLOWED: %',v_result; end if;

  -- Repeat visits count one stable business and the latest observation wins.
  perform public.confirm_field_visit_erp_v1(v_ret,jsonb_build_object('visit_id','00000000-0000-4000-8000-000000000033','lead_id','latest-retailer','visit_date','2026-08-12','check_in_time','2026-08-12T04:39:00Z','visit_outcome','interested','segment_type','Retailer','address','ERP test address','pincode','110001','created_at','2026-08-12T04:39:00Z','updated_at','2026-08-12T04:39:00Z','erp_usage_state','erp','erp_name_input','MARG'));
  perform public.confirm_field_visit_erp_v1(v_ret,jsonb_build_object('visit_id','00000000-0000-4000-8000-000000000034','lead_id','latest-retailer','visit_date','2026-08-12','check_in_time','2026-08-12T04:40:00Z','visit_outcome','interested','segment_type','Retailer','address','ERP test address','pincode','110001','created_at','2026-08-12T04:40:00Z','updated_at','2026-08-12T04:40:00Z','erp_usage_state','none'));
  select public.field_visit_erp_intelligence_v1() into v_intelligence;
  if (v_intelligence->'Retailer'->>'unique_businesses')::int <> 6
    or (v_intelligence->'Retailer'->>'erp_using_count')::int <> 3
    or (v_intelligence->'Retailer'->>'none_count')::int <> 2
    or (v_intelligence->'Retailer'->>'not_captured_count')::int <> 1
    or (v_intelligence->'Distributor'->>'unique_businesses')::int <> 1
    or (v_intelligence->'Distributor'->>'erp_using_count')::int <> 1 then
    raise exception 'LATEST_UNIQUE_SEGMENT_COUNTS_WRONG: %',v_intelligence;
  end if;
  select sum((category->>'count')::bigint), sum((category->>'share_percent')::numeric)
    into v_category_count,v_share from jsonb_array_elements(v_intelligence->'Retailer'->'categories') category;
  if v_category_count <> 6 or v_share <> 100.0
    or not exists(select 1 from jsonb_array_elements(v_intelligence->'Retailer'->'categories') c where c->>'erp_name'='None' and (c->>'count')::int=2)
    or not exists(select 1 from jsonb_array_elements(v_intelligence->'Retailer'->'categories') c where c->>'erp_name'='Not captured' and (c->>'count')::int=1)
    or not exists(select 1 from jsonb_array_elements(v_intelligence->'Distributor'->'categories') c where c->>'erp_name'='MARG' and (c->>'count')::int=1 and (c->>'share_percent')::numeric=100.0) then
    raise exception 'ERP_CATEGORY_RECONCILIATION_FAILED: %',v_intelligence;
  end if;

  if has_function_privilege('authenticated','public.confirm_field_visit_erp_v1(uuid,jsonb)','execute') then raise exception 'AUTHENTICATED_RPC_EXECUTE_ALLOWED'; end if;
  if (select count(*) from public.distributor_accounts)<>1 or exists(select 1 from public.distributor_accounts where erp_id is not null)
    or (select count(*) from public.pipeline_entries)<>1 or (select count(*) from public.call_logs)<>1
    or (select count(*) from public.receivables)<>1 or (select count(*) from public.receivable_payments)<>1 then
    raise exception 'CROSS_AUTHORITY_MUTATION';
  end if;
end $$;
select 'Migration 048 complete Field Visit ERP invariant matrix passed' as result;
