-- Read-only Owner postcheck. Compare actor UUID aggregate hashes to precheck evidence.
select count(*) total, count(*) filter (where status='Completed' and (mapped_by is null or completed_at is null)) malformed_completed, count(*) filter (where requested_by is not null and requested_by_name_snapshot is null) missing_requester_snapshot, count(*) filter (where mapped_by is not null and mapped_by_name_snapshot is null) missing_completer_snapshot from public.mapping_requests;
select tgname from pg_trigger where tgrelid='public.mapping_requests'::regclass and tgname='mapping_request_attribution_guard_v1';
select policyname, cmd from pg_policies where schemaname='public' and tablename='mapping_requests' order by policyname;
select has_table_privilege('authenticated','public.mapping_requests','DELETE') as authenticated_delete_granted;
select has_function_privilege('authenticated','public.mapping_request_attribution_guard_v1()','EXECUTE') as trigger_direct_execute_granted;
