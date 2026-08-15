\set ON_ERROR_STOP on
set role service_role;

do $$
declare admin_metrics jsonb; employee_metrics jsonb; expected_admin jsonb; expected_employee jsonb; today_ist date=(now() at time zone 'Asia/Kolkata')::date;
begin
 select jsonb_build_object(
  'overdue',count(*) filter(where renewal_date<today_ist),
  'today',count(*) filter(where renewal_date=today_ist),
  'tomorrow',count(*) filter(where renewal_date=today_ist+1),
  'in_two_days',count(*) filter(where renewal_date=today_ist+2)
 ) into expected_admin from public.distributor_accounts;
 select jsonb_build_object(
  'overdue',count(*) filter(where renewal_date<today_ist),
  'today',count(*) filter(where renewal_date=today_ist),
  'tomorrow',count(*) filter(where renewal_date=today_ist+1),
  'in_two_days',count(*) filter(where renewal_date=today_ist+2)
 ) into expected_employee from public.distributor_accounts where assigned_to='20000000-0000-4000-a000-000000000001';
 admin_metrics:=public.distributor_renewal_metrics_v1('10000000-0000-4000-a000-000000000001',true);
 employee_metrics:=public.distributor_renewal_metrics_v1('20000000-0000-4000-a000-000000000001',false);
 if admin_metrics<>expected_admin or employee_metrics<>expected_employee then raise exception 'renewal metrics inaccurate: %, %',admin_metrics,employee_metrics; end if;
 if public.distributor_renewal_metrics_v1('20000000-0000-4000-a000-000000000001',true)<>jsonb_build_object('overdue',0,'today',0,'tomorrow',0,'in_two_days',0) then raise exception 'forged admin read accepted'; end if;
 update public.users set is_active=false where user_id='20000000-0000-4000-a000-000000000002';
 if (public.distributor_renewals_list_v1('20000000-0000-4000-a000-000000000002',false,'all',1,50)->>'total')::integer<>0 then raise exception 'inactive renewal read accepted'; end if;
 update public.users set is_active=true where user_id='20000000-0000-4000-a000-000000000002';
end $$;

do $$
declare result jsonb; row_item jsonb; filter_name text;
begin
 foreach filter_name in array array['all','overdue','today','tomorrow','in_two_days','upcoming','not_set'] loop
  result:=public.distributor_renewals_list_v1('10000000-0000-4000-a000-000000000001',true,filter_name,1,500);
  if jsonb_array_length(result->'rows')>50 or (result->>'page_size')::integer<>50 then raise exception 'renewal page bound failed: %',result; end if;
  for row_item in select value from jsonb_array_elements(result->'rows') loop
   if not (row_item ?& array['distributor_id','distributor_name','assigned_to','assigned_employee_name','renewal_date','renewal_state','version','updated_at']) then raise exception 'renewal projection incomplete: %',row_item; end if;
  end loop;
 end loop;
 if exists(select 1 from jsonb_array_elements(public.distributor_renewals_list_v1('20000000-0000-4000-a000-000000000001',false,'all',1,50)->'rows') r where r->>'assigned_to'<>'20000000-0000-4000-a000-000000000001') then raise exception 'employee saw another assignment'; end if;
end $$;

do $$
declare target_id uuid='40000000-0000-4000-a000-000000000050'; current_version bigint; result jsonb; today_ist date=(now() at time zone 'Asia/Kolkata')::date;
begin
 select version into current_version from public.distributor_accounts where distributor_id=target_id;
 result:=public.distributor_status_command_v1(gen_random_uuid(),'20000000-0000-4000-a000-000000000001','renew',repeat('d',64),jsonb_build_object('distributor_id',target_id,'expected_version',current_version,'renewal_date',(today_ist+1)::text,'note','closure'));
 if not coalesce((result->>'success')::boolean,false) then raise exception 'renewal closure write failed: %',result; end if;
 if (select renewal_date from public.distributor_accounts where distributor_id=target_id)<>today_ist+1 then raise exception 'canonical renewal mismatch'; end if;
 if not exists(select 1 from jsonb_array_elements(public.distributor_renewals_list_v1('20000000-0000-4000-a000-000000000001',false,'tomorrow',1,50)->'rows') r where r->>'distributor_id'=target_id::text) then raise exception 'Payment Collection closure failed'; end if;
 if not exists(select 1 from jsonb_array_elements(public.distributor_renewals_list_v1('10000000-0000-4000-a000-000000000001',true,'tomorrow',1,50)->'rows') r where r->>'distributor_id'=target_id::text and r->>'renewal_date'=(today_ist+1)::text) then raise exception 'Admin renewal closure failed'; end if;
 if not exists(select 1 from jsonb_array_elements(public.distributor_renewals_due_v1('20000000-0000-4000-a000-000000000001',false,50)->'rows') r where r->>'distributor_id'=target_id::text and r->>'renewal_state'='renewal_due_tomorrow') then raise exception 'My Day closure failed'; end if;
 if not exists(select 1 from public.distributor_status_events where distributor_id=target_id and event_type='renewal_date_updated' and actor_id='20000000-0000-4000-a000-000000000001' and new_renewal_date=today_ist+1) then raise exception 'renewal audit missing'; end if;
 if exists(select 1 from protected_writes where writes<>0) then raise exception 'renewal crossed protected write set'; end if;
end $$;

do $$
declare target_id uuid='40000000-0000-4000-a000-000000000050'; stale_version bigint; admin_result jsonb; employee_result jsonb; today_ist date=(now() at time zone 'Asia/Kolkata')::date;
begin
 select version into stale_version from public.distributor_accounts where distributor_id=target_id;
 admin_result:=public.distributor_status_command_v1(gen_random_uuid(),'10000000-0000-4000-a000-000000000001','renew',repeat('e',64),jsonb_build_object('distributor_id',target_id,'expected_version',stale_version,'renewal_date',(today_ist+2)::text,'note','admin concurrency'));
 employee_result:=public.distributor_status_command_v1(gen_random_uuid(),'20000000-0000-4000-a000-000000000001','renew',repeat('f',64),jsonb_build_object('distributor_id',target_id,'expected_version',stale_version,'renewal_date',(today_ist+1)::text,'note','stale employee'));
 if not coalesce((admin_result->>'success')::boolean,false) or employee_result->>'code'<>'DISTRIBUTOR_CONFLICT' or not (employee_result ? 'current') then raise exception 'Admin/employee concurrency contract failed: %, %',admin_result,employee_result; end if;
 if (select renewal_date from public.distributor_accounts where distributor_id=target_id)<>today_ist+2 then raise exception 'Stale employee overwrote Admin renewal'; end if;
end $$;

\echo RENEWAL_METRICS_10K_QUERY_PLAN
explain (analyze,buffers,format text) select public.distributor_renewal_metrics_v1('10000000-0000-4000-a000-000000000001',true);
\echo RENEWAL_OVERDUE_50_QUERY_PLAN
explain (analyze,buffers,format text) select public.distributor_renewals_list_v1('10000000-0000-4000-a000-000000000001',true,'overdue',1,50);
\echo RENEWAL_EMPLOYEE_50_QUERY_PLAN
explain (analyze,buffers,format text) select public.distributor_renewals_list_v1('20000000-0000-4000-a000-000000000001',false,'all',1,50);
select 'RENEWAL_PAGE_ROWS='||jsonb_array_length(result->'rows')||';PAYLOAD_BYTES='||octet_length((result->'rows')::text) from (select public.distributor_renewals_list_v1('10000000-0000-4000-a000-000000000001',true,'all',1,50) result) measured;
select 'Payment Collection renewal integration passed.';
