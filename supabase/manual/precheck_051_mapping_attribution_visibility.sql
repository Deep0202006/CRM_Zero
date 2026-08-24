-- Read-only Owner precheck. Record results outside git; do not apply Migration 051 here.
select count(*) total, count(*) filter (where status='Completed') completed, count(*) filter (where status='Pending') pending, count(*) filter (where requested_by is null) requested_by_null, count(*) filter (where status='Completed' and mapped_by is null) completed_mapped_by_null, count(*) filter (where status='Completed' and completed_at is null) completed_at_null, count(*) filter (where requested_by is distinct from mapped_by) requester_not_completer from public.mapping_requests;
select policyname from pg_policies where schemaname='public' and tablename='mapping_requests' order by policyname;
select tgname from pg_trigger where tgrelid='public.mapping_requests'::regclass and not tgisinternal order by tgname;
select conname from pg_constraint where conrelid='public.mapping_requests'::regclass order by conname;
select column_name from information_schema.columns where table_schema='public' and table_name='mapping_requests' and column_name in ('requested_by_name_snapshot','mapped_by_name_snapshot');
