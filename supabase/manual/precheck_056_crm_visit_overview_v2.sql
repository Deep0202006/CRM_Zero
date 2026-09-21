-- OWNER READ-ONLY: run before migration 056. Catalog checks only.
begin;
set local statement_timeout='10s';
do $$ declare present_count integer; item record; begin
  if to_regprocedure('public.crm_visit_matches_v1(date,timestamptz,uuid,text,text,text[],date,date,uuid,text,text,text,date)') is null
    or not has_function_privilege('service_role','public.crm_visit_matches_v1(date,timestamptz,uuid,text,text,text[],date,date,uuid,text,text,text,date)','EXECUTE')
    then raise exception 'BCD056_055_PREREQUISITE'; end if;
  if not exists(select 1 from pg_roles where rolname='service_role' and rolbypassrls)
    or not exists(select 1 from pg_roles where rolname='anon')
    or not exists(select 1 from pg_roles where rolname='authenticated')
    then raise exception 'BCD056_REQUIRED_ROLES'; end if;
  if not has_table_privilege('service_role','public.field_visits','SELECT')
    or not has_table_privilege('service_role','public.users','SELECT')
    or not has_table_privilege('service_role','public.leads','SELECT')
    or not has_table_privilege('service_role','public.erp_systems','SELECT')
    then raise exception 'BCD056_SERVICE_SELECT'; end if;
  for item in select * from (values
    ('field_visits','visit_id','uuid'),('field_visits','created_at','timestamp with time zone'),('field_visits','user_id','uuid'),
    ('field_visits','lead_id','text'),('field_visits','visit_date','date'),('field_visits','check_in_time','timestamp with time zone'),
    ('field_visits','check_in_lat','double precision'),('field_visits','check_in_lng','double precision'),('field_visits','address','text'),
    ('field_visits','pincode','text'),('field_visits','segment_type','text'),('field_visits','person_met','text'),
    ('field_visits','visit_outcome','text'),('field_visits','visit_notes','text'),('field_visits','follow_up_date','date'),
    ('field_visits','erp_usage_state','text'),('field_visits','erp_id','uuid'),('field_visits','selfie_storage_path','text'),
    ('field_visits','selfie_purged_at','timestamp with time zone'),('users','user_id','uuid'),('users','name','text'),('users','email','text'),
    ('leads','lead_id','uuid'),('leads','business_name','text'),('leads','contact_person','text'),('leads','phone','text'),
    ('erp_systems','erp_id','uuid'),('erp_systems','erp_name','text')
  ) expected(relation,column_name,type_name) loop
    if not exists(select 1 from pg_attribute where attrelid=to_regclass('public.'||item.relation)
      and attname=item.column_name and not attisdropped and atttypid=to_regtype(item.type_name))
      then raise exception 'BCD056_COLUMN_TYPE %.% expected %',item.relation,item.column_name,item.type_name; end if;
  end loop;
  select count(*) into present_count from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('crm_visit_summary_v1','crm_visit_register_v2','crm_visit_export_v2');
  if present_count not in (0,3) then raise exception 'BCD056_PARTIAL_COLLISION_STOP'; end if;
  if present_count=3 and (
    to_regprocedure('public.crm_visit_summary_v1(date,date,uuid,text,text,text)') is null or
    to_regprocedure('public.crm_visit_register_v2(date,date,uuid,text,text,text,date,integer)') is null or
    to_regprocedure('public.crm_visit_export_v2(date,date,uuid,text,text,text,date,timestamptz,uuid)') is null)
    then raise exception 'BCD056_SIGNATURE_COLLISION_STOP'; end if;
end $$;
select case when to_regprocedure('public.crm_visit_summary_v1(date,date,uuid,text,text,text)') is null
  then 'BCD056_PRECHECK_PASS_NOT_APPLIED' else 'BCD056_PRECHECK_ALREADY_APPLIED_USE_POSTCHECK' end as result;
commit;
