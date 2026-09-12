-- OWNER READ-ONLY: run in the intended Supabase project's SQL Editor before055.
-- Catalog only. No fixture records, grants, migration metadata or business writes.
begin;
set local statement_timeout='10s';
do $$ declare item record; begin
  if not exists(select 1 from pg_roles where rolname='service_role' and rolbypassrls)
    or not exists(select 1 from pg_roles where rolname='anon')
    or not exists(select 1 from pg_roles where rolname='authenticated') then raise exception 'BCD055_REQUIRED_ROLES'; end if;
  for item in select * from (values
    ('users','user_id','uuid'),('users','name','text'),('users','email','text'),('users','is_active','boolean'),
    ('erp_systems','erp_id','uuid'),('erp_systems','erp_name','text'),
    ('user_capabilities','user_id','uuid'),('user_capabilities','capability_code','text'),
    ('leads','lead_id','uuid'),('leads','assigned_to','uuid'),('leads','business_name','text'),
    ('leads','contact_person','text'),('leads','phone','text'),('leads','area','text'),('leads','lead_source','text'),
    ('leads','segment_type','lead_segment'),('leads','status','lead_status'),
    ('leads','created_at','timestamp with time zone'),('leads','stage_entered_at','timestamp with time zone'),('leads','onboarded_at','timestamp with time zone'),
    ('field_visits','visit_id','uuid'),('field_visits','user_id','uuid'),('field_visits','lead_id','text'),
    ('field_visits','visit_date','date'),('field_visits','check_in_time','timestamp with time zone'),
    ('field_visits','visit_outcome','text'),('field_visits','segment_type','text'),('field_visits','visit_notes','text'),
    ('field_visits','person_met','text'),('field_visits','address','text'),('field_visits','pincode','text'),
    ('field_visits','erp_id','uuid'),('field_visits','erp_usage_state','text'),
    ('field_visits','created_at','timestamp with time zone'),('field_visits','check_in_lat','double precision'),('field_visits','check_in_lng','double precision'),
    ('field_visits','selfie_storage_path','text'),('field_visits','selfie_purged_at','timestamp with time zone'),('field_visits','follow_up_date','date'),
    ('call_logs','log_id','uuid'),('call_logs','user_id','uuid'),('call_logs','lead_id','uuid'),('call_logs','timestamp','timestamp with time zone'),
    ('call_logs','outcome','text'),
    ('mapping_requests','request_id','uuid'),('mapping_requests','mapped_by_id_snapshot','uuid'),('mapping_requests','completed_at','timestamp with time zone'),
    ('tasks','task_id','uuid'),('tasks','related_lead_id','uuid'),('tasks','due_date','date'),('tasks','is_active','boolean'),
    ('tasks','title','text'),('tasks','status','task_status_enum'),('tasks','priority','task_priority_enum'),
    ('pipeline_transition_operations','operation_id','uuid'),('pipeline_transition_operations','lead_id','uuid'),
    ('pipeline_transition_operations','confirmed_at','timestamp with time zone'),('pipeline_transition_operations','event_kind','text'),('pipeline_transition_operations','reason','text'),
    ('pipeline_transition_operations','actor_id','uuid'),('pipeline_transition_operations','expected_stage','text'),('pipeline_transition_operations','target_stage','text')
  ) expected(relation,column_name,type_name) loop
    if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.'||item.relation)
      and attname=item.column_name and not attisdropped and atttypid=to_regtype(item.type_name))
      then raise exception 'BCD055_COLUMN_TYPE %.% expected %',item.relation,item.column_name,item.type_name; end if;
    if not has_table_privilege('service_role','public.'||item.relation,'SELECT') then raise exception 'BCD055_SERVICE_SELECT %',item.relation; end if;
  end loop;
  for item in select * from (values
    ('idx_field_visits_user_date','field_visits',array['user_id','visit_date'],array[0,0]),
    ('idx_field_visits_lead_id','field_visits',array['lead_id'],array[0]),
    ('idx_call_logs_kpi_user_timestamp','call_logs',array['user_id','timestamp'],array[0,1]),
    ('pipeline_transition_operations_lead_confirmed_idx','pipeline_transition_operations',array['lead_id','confirmed_at'],array[0,1]),
    ('field_visits_erp_latest_business_idx','field_visits',array['segment_type','lead_id','check_in_time','created_at','visit_id'],array[0,0,1,1,1])
  ) expected(name,relation,keys,directions) loop
    if not exists(select 1 from pg_index i where i.indexrelid=to_regclass('public.'||item.name)
      and i.indrelid=to_regclass('public.'||item.relation) and i.indisvalid and i.indexprs is null and i.indpred is null
      and array(select a.attname::text from unnest(i.indkey) with ordinality k(num,position)
        join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.num order by k.position)=item.keys
      and array(select (i.indoption[n] & 1)::integer from generate_series(0,i.indnkeyatts-1) n)=item.directions)
      then raise exception 'BCD055_INDEX_DEFINITION %',item.name; end if;
  end loop;
  if to_regprocedure('public.field_visit_erp_intelligence_v1()') is null
    or not has_function_privilege('service_role','public.field_visit_erp_intelligence_v1()','EXECUTE') then raise exception 'BCD055_ERP_READER_PREREQUISITE'; end if;
  if exists(select 1 from (values ('idx_field_visits_user_date'),('idx_field_visits_lead_id'),
    ('idx_call_logs_kpi_user_timestamp'),('pipeline_transition_operations_lead_confirmed_idx'),('field_visits_erp_latest_business_idx')) expected(name)
    where not exists(select 1 from pg_index where indexrelid=to_regclass('public.'||expected.name) and indisvalid)) then raise exception 'BCD055_REQUIRED_INDEX'; end if;
  if exists(select 1 from (values ('mapping_request_attribution_guard_v1','mapping_requests'),('call_log_owner_audit_guard_v1','call_logs'),
    ('trg_guard_pipeline_employee_status_write','leads'),('trg_lead_stage_change','leads')) expected(name,relation)
    where not exists(select 1 from pg_trigger where tgrelid=to_regclass('public.'||expected.relation) and tgname=expected.name and tgenabled='O' and not tgisinternal)) then raise exception 'BCD055_WRITE_GUARD_PREREQUISITE'; end if;
  if not exists(select 1 from pg_constraint where conrelid='public.mapping_requests'::regclass and conname='mapping_requests_lifecycle_attribution_check' and convalidated)
    or not exists(select 1 from pg_constraint where conrelid='public.mapping_requests'::regclass and conname='mapping_requests_actor_snapshot_check' and convalidated)
    then raise exception 'BCD055_MAPPING054_PREREQUISITE'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='mapping_requests' and policyname='mapping_requests_creator_update')
    or not exists(select 1 from pg_policies where schemaname='public' and tablename='call_logs' and policyname='call_logs_update_creator')
    or exists(select 1 from pg_policies where schemaname='public' and tablename='call_logs' and policyname in ('call_logs_update_own_or_admin','Call logs strict isolation update')) then raise exception 'BCD055_CREATOR_POLICY_PREREQUISITE'; end if;
  if exists(select 1 from (values ('mapping_requests'),('field_visits'),('pipeline_transition_operations'),('call_logs')) expected(name)
    where not exists(select 1 from pg_class where oid=to_regclass('public.'||expected.name) and relrowsecurity)) then raise exception 'BCD055_RLS_PREREQUISITE'; end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=any(array[
    'crm_visit_matches_v1','crm_visit_events_v1','crm_visit_register_v1','crm_visit_export_v1','crm_visit_export_erp_v1',
    'crm_visit_representatives_v1','crm_pipeline_register_v1','crm_pipeline_history_v1'])) then raise exception 'BCD055_FUNCTION_COLLISION_STOP'; end if;
end $$;
select 'BCD055_PRECHECK_PASS_NOT_APPLIED' as result;
commit;
