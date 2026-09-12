-- OWNER READ-ONLY POSTCHECK: catalogs only; no business writes or stress queries.
begin;
set local statement_timeout='10s';
do $$ declare item record; f record; begin
  for item in select * from (values
    ('public.crm_visit_matches_v1(date,timestamptz,uuid,text,text,text[],date,date,uuid,text,text,text,date)','boolean','i'),
    ('public.crm_visit_events_v1(date,date,uuid,text,text,text,date,uuid)','TABLE(visit_id uuid, user_id uuid, visit_date date, check_in_time timestamp with time zone, visit_outcome text, segment_type text)','s'),
    ('public.crm_visit_register_v1(date,date,uuid,text,text,text,date,integer)','jsonb','s'),
    ('public.crm_visit_export_v1(date,date,uuid,text,text,text,date,timestamptz,uuid)','jsonb','s'),
    ('public.crm_visit_export_erp_v1()','jsonb','s'),
    ('public.crm_visit_representatives_v1(text,text,uuid,uuid)','jsonb','s'),
    ('public.crm_pipeline_register_v1(text,text,uuid,text,text,integer,integer,boolean,boolean,boolean,boolean,timestamptz)','jsonb','s'),
    ('public.crm_pipeline_history_v1(text,timestamptz,timestamptz)','jsonb','s')
  ) expected(signature,result,volatility) loop
    if to_regprocedure(item.signature) is null then raise exception 'BCD055_READER_MISSING %',item.signature; end if;
    select * into strict f from pg_proc where oid=to_regprocedure(item.signature);
    if f.prosecdef or f.provolatile::text<>item.volatility or pg_get_function_result(f.oid)<>item.result
      or (item.volatility='s' and not coalesce(f.proconfig @> array['search_path=pg_catalog, public','statement_timeout=7s'],false))
      or (item.volatility='i' and f.proconfig is not null)
      or has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('authenticated',f.oid,'EXECUTE')
      or not has_function_privilege('service_role',f.oid,'EXECUTE')
      or exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')
      then raise exception 'BCD055_READER_CONTRACT %',item.signature; end if;
    if (select count(*) from pg_proc where pronamespace=f.pronamespace and proname=f.proname)<>1 then raise exception 'BCD055_UNREVIEWED_OVERLOAD %',item.signature; end if;
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
  if exists(select 1 from (values ('mapping_request_attribution_guard_v1','mapping_requests'),('call_log_owner_audit_guard_v1','call_logs'),
    ('trg_guard_pipeline_employee_status_write','leads'),('trg_lead_stage_change','leads')) expected(name,relation)
    where not exists(select 1 from pg_trigger where tgrelid=to_regclass('public.'||expected.relation) and tgname=expected.name and tgenabled='O' and not tgisinternal)) then raise exception 'BCD055_WRITE_GUARD_CHANGED'; end if;
  if not exists(select 1 from pg_constraint where conrelid='public.mapping_requests'::regclass and conname='mapping_requests_lifecycle_attribution_check' and convalidated)
    or not exists(select 1 from pg_constraint where conrelid='public.mapping_requests'::regclass and conname='mapping_requests_actor_snapshot_check' and convalidated)
    then raise exception 'BCD055_MAPPING_CONSTRAINT_CHANGED'; end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='mapping_requests' and policyname='mapping_requests_creator_update')
    or not exists(select 1 from pg_policies where schemaname='public' and tablename='call_logs' and policyname='call_logs_update_creator')
    or exists(select 1 from pg_policies where schemaname='public' and tablename='call_logs' and policyname in ('call_logs_update_own_or_admin','Call logs strict isolation update'))
    then raise exception 'BCD055_CREATOR_POLICY_CHANGED'; end if;
  if exists(select 1 from (values ('mapping_requests'),('field_visits'),('pipeline_transition_operations'),('call_logs')) expected(name)
    where not exists(select 1 from pg_class where oid=to_regclass('public.'||expected.name) and relrowsecurity)) then raise exception 'BCD055_RLS_CHANGED'; end if;
  if exists(select 1 from (values ('idx_field_visits_user_date'),('idx_field_visits_lead_id'),
    ('idx_call_logs_kpi_user_timestamp'),('pipeline_transition_operations_lead_confirmed_idx'),('field_visits_erp_latest_business_idx')) expected(name)
    where not exists(select 1 from pg_index where indexrelid=to_regclass('public.'||expected.name) and indisvalid)) then raise exception 'BCD055_INDEX_CHANGED'; end if;
end $$;
select 'BCD055_POSTCHECK_PASS_OWNER_EVIDENCE_REQUIRED' as result;
commit;
