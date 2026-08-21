\set ON_ERROR_STOP on
do $$
declare
  a uuid := '00000000-0000-4000-8000-000000000004';
  f uuid := '00000000-0000-4000-8000-000000000001';
  p uuid := '00000000-0000-4000-8000-000000000003';
  r jsonb; v1 jsonb; v2 jsonb; n integer; rt integer; dt integer;
begin
  if (select count(*) from public.field_business_erp_baselines)<>0 then raise exception 'ZERO_BACKFILL_FAILED'; end if;
  select public.field_visit_erp_intelligence_v1() into v1;

  -- Existing ERP, custom ERP, and explicit None.
  select public.set_field_business_erp_baselines_v1(p_actor_id=>a,p_rows=>jsonb_build_array(
    jsonb_build_object('operation','set','segment_type','Retailer','business_ref','existing-retailer','erp_id','60000000-0000-4000-a000-000000000001'),
    jsonb_build_object('operation','set','segment_type','Retailer','business_ref','custom-retailer','erp_name','  Acme   Current ERP '),
    jsonb_build_object('operation','none','segment_type','Retailer','business_ref','none-retailer'))) into r;
  if not coalesce((r->>'success')::boolean,false) or (r->>'operation_count')::int<>3
    or not exists(select 1 from public.field_business_erp_baselines where business_ref='existing-retailer' and erp_id='60000000-0000-4000-a000-000000000001' and erp_usage_state='erp')
    or not exists(select 1 from public.erp_systems where erp_key='acme current erp' and erp_name='Acme Current ERP')
    or not exists(select 1 from public.field_business_erp_baselines where business_ref='none-retailer' and erp_usage_state='none' and erp_id is null)
  then raise exception 'EXISTING_CUSTOM_NONE_FAILED: %',r; end if;
  if public.field_visit_erp_intelligence_v1()<>v1 then raise exception 'BASELINE_MUTATED_V1_AUTHORITY'; end if;

  -- Non-Admin field staff and ERP Partner denial.
  select count(*) into n from public.erp_systems;
  foreach r in array array[
    public.set_field_business_erp_baselines_v1(f,jsonb_build_array(jsonb_build_object('operation','none','segment_type','Retailer','business_ref','repeat-retailer'))),
    public.set_field_business_erp_baselines_v1(p,jsonb_build_array(jsonb_build_object('operation','none','segment_type','Retailer','business_ref','repeat-retailer')))
  ] loop if r->>'code'<>'ADMIN_REQUIRED' then raise exception 'NON_ADMIN_NOT_DENIED: %',r; end if; end loop;
  if (select count(*) from public.erp_systems)<>n or exists(select 1 from public.field_business_erp_baselines where business_ref='repeat-retailer') then raise exception 'DENIAL_MUTATED_STATE'; end if;

  -- Batch maximum and invalid all-or-nothing behavior.
  select public.set_field_business_erp_baselines_v1(a,(select jsonb_agg(jsonb_build_object('operation','none','segment_type','Retailer','business_ref','repeat-retailer')) from generate_series(1,501))) into r;
  if r->>'code'<>'BATCH_SIZE_INVALID' then raise exception 'BATCH_MAX_NOT_ENFORCED: %',r; end if;
  select count(*) into n from public.erp_systems;
  select public.set_field_business_erp_baselines_v1(a,jsonb_build_array(
    jsonb_build_object('operation','set','segment_type','Retailer','business_ref','repeat-retailer','erp_name','Must Roll Back ERP'),
    jsonb_build_object('operation','none','segment_type','Retailer','business_ref','missing-business'))) into r;
  if r->>'code'<>'BUSINESS_NOT_VISITED' or exists(select 1 from public.erp_systems where erp_key='must roll back erp')
    or (select count(*) from public.erp_systems)<>n or (select count(*) from public.field_business_erp_baselines)<>3
  then raise exception 'INVALID_BATCH_WAS_PARTIAL: %',r; end if;

  -- Baseline wins over older capture; newer captured visit wins over baseline.
  if not exists(select 1 from public.field_business_erp_current_v2('Retailer','existing-retailer',500) where provenance='manual_baseline' and erp_name='MARG') then raise exception 'BASELINE_RECENCY_FAILED'; end if;
  insert into public.field_visits(visit_id,lead_id,user_id,visit_date,check_in_time,visit_outcome,segment_type,erp_usage_state,erp_id)
  values('49000000-0000-4000-8000-000000000009','existing-retailer',f,'2100-01-01','2100-01-01T00:00:00Z','interested','Retailer','none',null);
  if not exists(select 1 from public.field_business_erp_current_v2('Retailer','existing-retailer',500) where provenance='field_visit' and erp_usage_state='none' and effective_at='2100-01-01T00:00:00Z') then raise exception 'VISIT_RECENCY_FAILED'; end if;
  insert into public.field_visits(visit_id,lead_id,user_id,visit_date,check_in_time,visit_outcome,segment_type,erp_usage_state,erp_id)
  values('49000000-0000-4000-8000-000000000010','existing-retailer',f,'2101-01-01','2101-01-01T00:00:00Z','interested','Retailer',null,null);
  if not exists(select 1 from public.field_business_erp_current_v2('Retailer','existing-retailer',500) where erp_usage_state='none' and effective_at='2100-01-01T00:00:00Z' and latest_visit_at='2101-01-01T00:00:00Z') then raise exception 'UNKNOWN_COMPETED_AS_FACT'; end if;

  -- Clear only manual authority and reveal Not captured.
  select public.set_field_business_erp_baselines_v1(a,jsonb_build_array(jsonb_build_object('operation','clear','segment_type','Retailer','business_ref','custom-retailer'))) into r;
  if not coalesce((r->>'success')::boolean,false) or exists(select 1 from public.field_business_erp_baselines where business_ref='custom-retailer')
    or not exists(select 1 from public.field_business_erp_current_v2('Retailer','custom-retailer',500) where provenance='not_captured' and erp_usage_state is null)
  then raise exception 'CLEAR_OR_NOT_CAPTURED_FAILED: %',r; end if;

  -- Same reference remains separate across segments; repeated visits count once.
  perform public.set_field_business_erp_baselines_v1(a,jsonb_build_array(
    jsonb_build_object('operation','none','segment_type','Retailer','business_ref','shared-business'),
    jsonb_build_object('operation','set','segment_type','Distributor','business_ref','shared-business','erp_id','60000000-0000-4000-a000-000000000001')));
  if not exists(select 1 from public.field_business_erp_current_v2('Retailer','shared-business',500) where erp_usage_state='none')
    or not exists(select 1 from public.field_business_erp_current_v2('Distributor','shared-business',500) where erp_name='MARG') then raise exception 'SEGMENT_SEPARATION_FAILED'; end if;
  select count(distinct lead_id) into rt from public.field_visits where segment_type='Retailer';
  select count(distinct lead_id) into dt from public.field_visits where segment_type='Distributor';
  select public.field_visit_erp_intelligence_v2() into v2;
  if (v2->'Retailer'->>'unique_businesses')::int<>rt or (v2->'Distributor'->>'unique_businesses')::int<>dt
    or (v2->'Retailer'->>'unique_businesses')::int<>(v2->'Retailer'->>'observed_count')::int+(v2->'Retailer'->>'not_captured_count')::int
    or (v2->'Distributor'->>'unique_businesses')::int<>(v2->'Distributor'->>'observed_count')::int+(v2->'Distributor'->>'not_captured_count')::int
    or (v2->'Retailer'->>'observed_count')::int<>(v2->'Retailer'->>'erp_using_count')::int+(v2->'Retailer'->>'none_count')::int
    or not exists(select 1 from jsonb_array_elements(v2->'Retailer'->'categories') c where c->>'state'='none')
    or not exists(select 1 from jsonb_array_elements(v2->'Retailer'->'categories') c where c->>'state'='not_captured')
  then raise exception 'UNIQUENESS_OR_RECONCILIATION_FAILED: %',v2; end if;

  -- Direct authenticated denial and protected-authority sentinels.
  if has_table_privilege('authenticated','public.field_business_erp_baselines','select') or has_table_privilege('authenticated','public.field_business_erp_baselines','insert')
    or has_function_privilege('authenticated','public.set_field_business_erp_baselines_v1(uuid,jsonb)','execute')
    or has_function_privilege('authenticated','public.field_business_erp_current_v2(text,text,integer)','execute')
  then raise exception 'DIRECT_AUTHENTICATED_DENIAL_FAILED'; end if;
  if (select count(*) from public.distributor_accounts)<>1 or exists(select 1 from public.distributor_accounts where erp_id is not null)
    or (select count(*) from public.pipeline_entries)<>1 or (select count(*) from public.call_logs)<>1
    or (select count(*) from public.receivables)<>1 or (select count(*) from public.receivable_payments)<>1
  then raise exception 'CROSS_AUTHORITY_MUTATION'; end if;
end $$;
select 'Migration 049 complete current ERP baseline matrix passed' as result;
