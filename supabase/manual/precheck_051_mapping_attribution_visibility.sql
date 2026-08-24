-- Read-only Owner precheck. Record results outside git; do not apply Migration 051 here.
begin read only;
select count(*) total, count(*) filter (where status='Completed') completed, count(*) filter (where status='Pending') pending, count(*) filter (where requested_by is null) requested_by_null, count(*) filter (where status='Completed' and mapped_by is null) completed_mapped_by_null, count(*) filter (where status='Completed' and completed_at is null) completed_at_null, count(*) filter (where requested_by is distinct from mapped_by) requester_not_completer from public.mapping_requests;
select policyname from pg_policies where schemaname='public' and tablename='mapping_requests' order by policyname;
select tgname from pg_trigger where tgrelid='public.mapping_requests'::regclass and not tgisinternal order by tgname;
select conname from pg_constraint where conrelid='public.mapping_requests'::regclass order by conname;
select column_name from information_schema.columns where table_schema='public' and table_name='mapping_requests' and column_name in ('requested_by_name_snapshot','mapped_by_name_snapshot');
select encode(digest(string_agg(request_id::text || '|' || coalesce(requested_by::text,''), E'\n' order by request_id), 'sha256'), 'hex') as requester_binding_fingerprint from public.mapping_requests;
select encode(digest(string_agg(request_id::text || '|' || coalesce(mapped_by::text,''), E'\n' order by request_id), 'sha256'), 'hex') as completer_binding_fingerprint from public.mapping_requests;
select encode(digest(string_agg(concat_ws('|',request_id,distributor_lead_id,retailer_lead_id,distributor_name_unregistered,retailer_name_unregistered,requested_by,mapped_by,status,notes,created_at,completed_at), E'\n' order by request_id), 'sha256'), 'hex') as business_fingerprint from public.mapping_requests;
commit;
