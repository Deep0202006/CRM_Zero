do $$ declare n integer; cursor_id uuid; begin
  if has_function_privilege('anon','public.crm_visit_events_v1(date,date,uuid,text,text,text,date,uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.crm_visit_events_v1(date,date,uuid,text,text,text,date,uuid)','EXECUTE') then raise exception 'PUBLIC_EXECUTION_GRANTED'; end if;
  if (select prosecdef from pg_proc where oid='public.crm_visit_events_v1(date,date,uuid,text,text,text,date,uuid)'::regprocedure) then raise exception 'DEFINER_READER'; end if;
  select count(*) into n from public.crm_visit_events_v1('2026-08-01','2026-08-02',null,null,null,'Matching business');
  if n<>61 then raise exception 'SEARCH_TRUNCATED %',n; end if;
  select count(*) into n from public.crm_visit_events_v1('2026-08-01','2026-08-02',null,null,null,'Matching representative');
  if n<>61 then raise exception 'REPRESENTATIVE_SEARCH_TRUNCATED %',n; end if;
  select count(*) into n from public.crm_visit_events_v1('2026-08-01','2026-08-02',md5('user61')::uuid);
  if n<>2 then raise exception 'FORMER_REPRESENTATIVE_EXCLUDED'; end if;
  select count(*) into n from public.crm_visit_events_v1('2026-08-01','2026-08-02',null,null,null,'1 rep1');
  if n<>0 then raise exception 'CROSS_FIELD_SEARCH_MATCH'; end if;
  select count(*) into n from public.crm_visit_events_v1('2026-08-01','2026-08-02',null,null,null,'legacy searchable');
  if n<>1 then raise exception 'LEGACY_SEARCH_FAILED'; end if;
  select count(*) into n from public.crm_visit_events_v1('2026-08-03','2026-08-03');
  if n<>1000 then raise exception 'PAGE_BOUND_FAILED'; end if;
  select visit_id into cursor_id from public.crm_visit_events_v1('2026-08-03','2026-08-03') offset 999;
  select count(*) into n from public.crm_visit_events_v1('2026-08-03','2026-08-03',null,null,null,'','2026-08-03',cursor_id);
  if n<>1 then raise exception 'KEYSET_LOST_ROWS'; end if;
  begin
    perform public.crm_visit_events_v1('2026-08-03','2026-08-01');
    raise exception 'INVALID_RANGE_ACCEPTED';
  exception when invalid_parameter_value then null; end;
  begin
    perform public.crm_visit_events_v1('2026-08-01','2026-08-01',null,null,'invented');
    raise exception 'INVALID_OUTCOME_ACCEPTED';
  exception when invalid_parameter_value then null; end;
  begin
    set local role anon;
    perform public.crm_visit_events_v1('2026-08-01','2026-08-01');
    raise exception 'ANON_EXECUTION_ALLOWED';
  exception when insufficient_privilege then reset role; end;
  begin
    set local role authenticated;
    perform public.crm_visit_events_v1('2026-08-01','2026-08-01');
    raise exception 'AUTHENTICATED_EXECUTION_ALLOWED';
  exception when insufficient_privilege then reset role; end;
end $$;
set role service_role;
do $$ begin
  if (select count(*) from public.crm_visit_events_v1('2026-08-01','2026-08-02')) <> 62 then raise exception 'SERVICE_READ_DENIED_OR_INCOMPLETE'; end if;
end $$;
reset role;
explain (analyze, buffers) select * from public.crm_visit_events_v1('2026-08-01','2026-08-03');

-- Disposable HTTP fixture only: verifies PostgREST hoists function timeout settings.
create function public.crm_bcd_timeout_fixture() returns boolean
language sql volatile security invoker set statement_timeout = '75ms'
as $$ select true from pg_catalog.pg_sleep(0.3) $$;
revoke all on function public.crm_bcd_timeout_fixture() from public,anon,authenticated;
grant execute on function public.crm_bcd_timeout_fixture() to service_role;
