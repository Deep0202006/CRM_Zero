\set ON_ERROR_STOP on
do $$
declare a uuid := '10000000-0000-4000-8000-000000000001'; b uuid := '10000000-0000-4000-8000-000000000002'; u uuid := '10000000-0000-4000-8000-000000000004'; r uuid := '20000000-0000-4000-8000-000000000002'; affected integer;
begin
  if not exists(select 1 from public.mapping_requests where request_id='20000000-0000-4000-8000-000000000001' and requested_by_id_snapshot=a and mapped_by_id_snapshot=b and requested_by_name_snapshot='Employee A' and mapped_by_name_snapshot='Employee B') then raise exception 'HISTORICAL_BACKFILL_FAILED'; end if;
  perform set_config('request.jwt.claim.sub',a::text,true); set local role authenticated;
  if (select count(*) from public.mapping_requests) <> 1 then raise exception 'SUPPORT_TEAM_SELECT_FAILED'; end if;
  insert into public.mapping_requests(request_id,distributor_name_unregistered,retailer_name_unregistered,requested_by,mapped_by,status) values(r,'New Distributor','New Retailer',b,a,'Pending');
  reset role;
  if not exists(select 1 from public.mapping_requests where request_id=r and requested_by=a and requested_by_id_snapshot=a and requested_by_name_snapshot='Employee A' and mapped_by is null and mapped_by_id_snapshot is null) then raise exception 'SPOOFED_INSERT_NOT_REBOUND'; end if;
  perform set_config('request.jwt.claim.sub',b::text,true); set local role authenticated;
  update public.mapping_requests set status='Completed',mapped_by=a,requested_by_name_snapshot='poison',completed_at=timezone('utc',now()) where request_id=r;
  reset role;
  if not exists(select 1 from public.mapping_requests where request_id=r and requested_by=a and requested_by_id_snapshot=a and requested_by_name_snapshot='Employee A' and mapped_by=b and mapped_by_id_snapshot=b and mapped_by_name_snapshot='Employee B' and completed_at is not null) then raise exception 'COMPLETION_ATTRIBUTION_FAILED'; end if;
  perform set_config('request.jwt.claim.sub',b::text,true); set local role authenticated;
  update public.mapping_requests set notes='rewrite' where request_id=r;
  get diagnostics affected = row_count;
  reset role;
  if affected <> 0 then raise exception 'COMPLETED_REWRITE_ALLOWED'; end if;
  perform set_config('request.jwt.claim.sub',a::text,true); set local role authenticated;
  delete from public.mapping_requests where request_id=r;
  get diagnostics affected = row_count;
  reset role;
  if affected <> 0 then raise exception 'DELETE_ALLOWED'; end if;
  perform set_config('request.jwt.claim.sub',u::text,true); set local role authenticated;
  if exists(select 1 from public.mapping_requests) then raise exception 'UNRELATED_SELECT_ALLOWED'; end if;
  reset role;
  delete from public.users where user_id=a;
  if not exists(select 1 from public.mapping_requests where request_id=r and requested_by is null and requested_by_id_snapshot=a and requested_by_name_snapshot='Employee A') then raise exception 'REQUESTER_DELETE_AUDIT_LOST'; end if;
  delete from public.users where user_id=b;
  if not exists(select 1 from public.mapping_requests where request_id=r and mapped_by is null and mapped_by_id_snapshot=b and mapped_by_name_snapshot='Employee B' and status='Completed') then raise exception 'COMPLETER_DELETE_AUDIT_LOST'; end if;
  if has_function_privilege('authenticated','public.mapping_request_attribution_guard_v1()','execute') or has_function_privilege('anon','public.mapping_request_attribution_guard_v1()','execute') then raise exception 'TRIGGER_EXECUTE_EXPOSED'; end if;
end $$;
select 'Migration 051 Mapping attribution/RLS matrix passed' as result;
