-- OWNER READ-ONLY POSTCHECK: catalogs only; no business writes or stress queries.
begin;
set local statement_timeout='10s';
do $$ declare item record; f record; begin
  for item in select * from (values
    ('public.crm_visit_summary_v1(date,date,uuid,text,text,text)','jsonb'),
    ('public.crm_visit_register_v2(date,date,uuid,text,text,text,date,integer)','jsonb'),
    ('public.crm_visit_export_v2(date,date,uuid,text,text,text,date,timestamptz,uuid)','jsonb')
  ) expected(signature,result) loop
    if to_regprocedure(item.signature) is null then raise exception 'BCD056_READER_MISSING %',item.signature; end if;
    select * into strict f from pg_proc where oid=to_regprocedure(item.signature);
    if f.prosecdef or f.provolatile<>'s' or pg_get_function_result(f.oid)<>item.result
      or not coalesce(f.proconfig @> array['search_path=pg_catalog, public','statement_timeout=7s'],false)
      or has_function_privilege('anon',f.oid,'EXECUTE') or has_function_privilege('authenticated',f.oid,'EXECUTE')
      or not has_function_privilege('service_role',f.oid,'EXECUTE')
      or exists(select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')
      then raise exception 'BCD056_READER_CONTRACT %',item.signature; end if;
    if (select count(*) from pg_proc where pronamespace=f.pronamespace and proname=f.proname)<>1
      then raise exception 'BCD056_UNREVIEWED_OVERLOAD %',item.signature; end if;
  end loop;
  if to_regprocedure('public.crm_visit_events_v1(date,date,uuid,text,text,text,date,uuid)') is null
    or to_regprocedure('public.crm_visit_register_v1(date,date,uuid,text,text,text,date,integer)') is null
    or to_regprocedure('public.crm_visit_export_v1(date,date,uuid,text,text,text,date,timestamptz,uuid)') is null
    then raise exception 'BCD056_V1_ROLLBACK_CONTRACT'; end if;
end $$;
select 'BCD056_POSTCHECK_PASS_OWNER_EVIDENCE_REQUIRED' as result;
commit;
