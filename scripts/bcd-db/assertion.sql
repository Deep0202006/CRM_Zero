do $$ begin
  if to_regclass('public.field_visits_erp_latest_business_idx') is null
    or to_regprocedure('public.field_visit_erp_intelligence_v1()') is null
    or not (select relrowsecurity from pg_class where oid='public.erp_systems'::regclass)
    or exists(select 1 from (values ('pincode','text'),('selfie_storage_path','text'),('erp_id','uuid'),('erp_usage_state','text')) expected(name,type)
      left join information_schema.columns c on c.table_schema='public' and c.table_name='field_visits' and c.column_name=expected.name
      where c.data_type is distinct from expected.type) then raise exception 'EXPORT_TRACKED_SCHEMA_EXTRACTION'; end if;
  if public.crm_visit_export_erp_v1() is distinct from public.field_visit_erp_intelligence_v1() then raise exception 'EXPORT_ERP_SEMANTICS'; end if;
  begin
    update public.erp_systems set erp_name=repeat(' ',10000)||'Synthetic ERP' where erp_id=md5('erp')::uuid;
    perform public.crm_visit_export_erp_v1(); raise exception 'EXPORT_ERP_RAW_NAME_UNBOUNDED';
  exception when program_limit_exceeded then null; end;
  if jsonb_array_length(public.crm_visit_export_v1('2026-08-01','2026-08-02',null,null,null,'Matching business'))<>61 then raise exception 'EXPORT_JOINED_SEARCH'; end if;
  if jsonb_array_length(public.crm_visit_export_v1('2026-08-03','2026-08-03',null,null,null,'%_,().'))<>1 then raise exception 'EXPORT_LITERAL_SEARCH'; end if;
  begin perform public.crm_visit_export_v1(); raise exception 'EXPORT_UNBOUNDED_RANGE'; exception when invalid_parameter_value then null; end;
  begin perform public.crm_visit_export_v1('2026-08-01','2026-09-01'); raise exception 'EXPORT_OVERSIZED_RANGE'; exception when invalid_parameter_value then null; end;
  begin perform public.crm_visit_export_v1('2026-08-01','2026-08-02',p_after_created=>now()); raise exception 'EXPORT_PARTIAL_CURSOR'; exception when invalid_parameter_value then null; end;
  begin
    update public.field_visits set visit_notes=repeat('x',32768) where visit_id=md5('legacy')::uuid;
    perform public.crm_visit_export_v1('2026-08-02','2026-08-02');
    raise exception 'EXPORT_OVERSIZED_CELL_ACCEPTED';
  exception when program_limit_exceeded then null; end;
end $$;
do $$ declare n integer; cursor_id uuid; begin
  if has_function_privilege('anon','public.crm_visit_events_v1(date,date,uuid,text,text,text,date,uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.crm_visit_events_v1(date,date,uuid,text,text,text,date,uuid)','EXECUTE') then raise exception 'PUBLIC_EXECUTION_GRANTED'; end if;
  if (select prosecdef from pg_proc where oid='public.crm_visit_events_v1(date,date,uuid,text,text,text,date,uuid)'::regprocedure) then raise exception 'DEFINER_READER'; end if;
  select count(*) into n from public.crm_visit_events_v1('2026-08-01','2026-08-02',null,null,null,'Matching business');
  if n<>61 then raise exception 'SEARCH_TRUNCATED %',n; end if;
  select count(*) into n from public.crm_visit_events_v1('2026-08-01','2026-08-02',null,null,null,'Matching representative');
  -- 61 matching representatives own62 visits: the legacy row also belongs to rep61.
  if n<>62 then raise exception 'REPRESENTATIVE_SEARCH_TRUNCATED %',n; end if;
  if (select count(distinct user_id) from public.crm_visit_events_v1('2026-08-01','2026-08-02',null,null,null,'Matching representative'))<>61
    or not exists(select 1 from public.crm_visit_events_v1('2026-08-01','2026-08-02',null,null,null,'Matching representative') where visit_id=md5('legacy')::uuid)
    then raise exception 'REPRESENTATIVE_SEARCH_IDENTITY_MISMATCH'; end if;
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

-- Shared caller security and real register/picker contracts (not merely SQL syntax).
do $$ declare signature text; f record; a jsonb; b jsonb; expected jsonb; begin
  foreach signature in array array[
    'public.crm_visit_events_v1(date,date,uuid,text,text,text,date,uuid)',
    'public.crm_visit_register_v1(date,date,uuid,text,text,text,date,integer)',
    'public.crm_visit_representatives_v1(text,text,uuid,uuid)',
    'public.crm_visit_export_v1(date,date,uuid,text,text,text,date,timestamptz,uuid)',
    'public.crm_visit_export_erp_v1()'
  ] loop
    select * into strict f from pg_proc where oid=signature::regprocedure;
    if f.prosecdef or f.provolatile<>'s' or not (f.proconfig @> array['search_path=pg_catalog, public','statement_timeout=7s'])
      or has_function_privilege('anon',signature,'EXECUTE') or has_function_privilege('authenticated',signature,'EXECUTE')
      or not has_function_privilege('service_role',signature,'EXECUTE') then raise exception 'READER_CATALOG_CONTRACT %',signature; end if;
  end loop;
  a:=public.crm_visit_register_v1('2026-08-01','2026-08-02',null,null,null,'Matching representative');
  b:=public.crm_visit_register_v1('2026-08-01','2026-08-02',null,null,null,'Matching representative',null,2);
  select jsonb_agg(visit_id order by created_at desc,visit_id desc) into expected from public.field_visits where visit_date between '2026-08-01' and '2026-08-02';
  if a->>'total'<>'62' or jsonb_array_length(a->'visit_ids')<>50 or b->>'total'<>'62' or jsonb_array_length(b->'visit_ids')<>12
    or ((a->'visit_ids')||(b->'visit_ids'))<>expected or a->>'has_more'<>'true' or b->>'has_more'<>'false' then raise exception 'REGISTER_PAGING_RECONCILIATION'; end if;
  a:=public.crm_visit_register_v1(null,null,null,null,null,'','2026-08-01');
  if a->>'total'<>'62' or a->>'legacy_date_mismatch_count'<>'1' then raise exception 'REGISTER_LEGACY_IST_BOUNDARY'; end if;
  if public.crm_visit_matches_v1('1000-02-02','1000-01-31 18:10:00+00',md5('user1')::uuid,'Retailer','interested',array[]::text[],null,null,null,null,null,'','1000-02-01')
    or not public.crm_visit_matches_v1('1000-02-02','1000-01-31 18:30:00+00',md5('user1')::uuid,'Retailer','interested',array[]::text[],null,null,null,null,null,'','1000-02-01')
    or public.crm_visit_matches_v1('1000-02-02','1000-02-01 18:30:00+00',md5('user1')::uuid,'Retailer','interested',array[]::text[],null,null,null,null,null,'','1000-02-01') then raise exception 'REGISTER_LEGACY_FIXED_OFFSET_PARITY'; end if;
  a:=public.crm_visit_register_v1('2026-08-01','2026-08-01');
  if a->>'total'<>'61' or a->>'legacy_date_mismatch_count'<>'0' then raise exception 'REGISTER_CANONICAL_DATE'; end if;
  a:=public.crm_visit_register_v1('2026-08-01','2026-08-02',md5('user61')::uuid);
  if a->>'total'<>'2' then raise exception 'REGISTER_INACTIVE_REPRESENTATIVE'; end if;
  a:=public.crm_visit_register_v1('2026-08-01','2026-08-02',null,null,null,'1 rep1');
  if a->>'total'<>'0' then raise exception 'REGISTER_CROSS_FIELD_SEARCH'; end if;
  a:=public.crm_visit_register_v1('2026-08-01','2026-08-02',null,null,null,'%');
  if a->>'total'<>'0' then raise exception 'REGISTER_WILDCARD_SEARCH'; end if;
  begin perform public.crm_visit_register_v1('2026-08-01',null); raise exception 'REGISTER_PARTIAL_RANGE'; exception when invalid_parameter_value then null; end;
  begin perform public.crm_visit_register_v1('2026-08-01','2026-09-01'); raise exception 'REGISTER_OVERSIZED_RANGE'; exception when invalid_parameter_value then null; end;
  begin perform public.crm_visit_register_v1('2026-08-01','2026-08-02',null,null,null,'','2026-08-01'); raise exception 'REGISTER_AMBIGUOUS_DATE'; exception when invalid_parameter_value then null; end;
  begin perform public.crm_visit_register_v1(p_page=>401); raise exception 'REGISTER_UNBOUNDED_PAGE'; exception when invalid_parameter_value then null; end;
  a:=public.crm_visit_representatives_v1('Matching representative 1',null,null,md5('user61')::uuid);
  if jsonb_array_length(a->'items')<>11 or a->'selected'->>'user_id'<>md5('user61')::uuid::text
    or a->'selected'->>'is_active'<>'false' or a->'selected'->>'historical_only'<>'true' then raise exception 'PICKER_SELECTED_OUTSIDE_SEARCH'; end if;
  a:=public.crm_visit_representatives_v1('current-only');
  if jsonb_array_length(a->'items')<>1 or a->'items'->0->>'historical_only'<>'false'
    or length(a->'items'->0->>'name')<>1001 or length(a->'items'->0->>'cursor_name')<>1000 then raise exception 'PICKER_CURRENT_WITHOUT_VISITS'; end if;
  b:=public.crm_visit_representatives_v1('',a->'items'->0->>'cursor_name',(a->'items'->0->>'user_id')::uuid);
  if jsonb_array_length(b->'items')<>0 then raise exception 'PICKER_LONG_NAME_CURSOR'; end if;
  a:=public.crm_visit_representatives_v1('not-field',null,null,md5('not-field')::uuid);
  if jsonb_array_length(a->'items')<>0 or a->'selected'<>'null'::jsonb then raise exception 'PICKER_FOREIGN_MEMBERSHIP'; end if;
end $$;

-- Disposable HTTP fixture only: verifies PostgREST hoists function timeout settings.
create function public.crm_bcd_timeout_fixture() returns boolean
language sql volatile security invoker set statement_timeout = '75ms'
as $$ select true from pg_catalog.pg_sleep(0.3) $$;
revoke all on function public.crm_bcd_timeout_fixture() from public,anon,authenticated;
grant execute on function public.crm_bcd_timeout_fixture() to service_role;
