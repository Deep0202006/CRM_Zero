-- Read-only postcheck. Compare all counts with owner-041-precheck.sql.
select jsonb_build_object(
 'users',(select count(*) from public.users),
 'leads',(select count(*) from public.leads),
 'calls',(select count(*) from public.call_logs),
 'attendance',(select count(*) from public.attendance),
 'field_visits',(select count(*) from public.field_visits),
 'tasks',(select count(*) from public.tasks),
 'receivables',(select count(*) from public.receivables),
 'receivable_payments',(select count(*) from public.receivable_payments),
 'distributor_accounts',(select count(*) from public.distributor_accounts),
 'distributor_events',(select count(*) from public.distributor_status_events),
 'mapping_columns',(select count(*) from information_schema.columns where table_schema='public' and table_name='distributor_accounts' and column_name in ('mapping_status','mapped_at')),
 'legacy_mapping_rows_preserved',(select count(*) from public.distributor_accounts where mapping_status is null),
 'instruction','Compare every business count with owner-041-precheck.sql; every count must be identical. mapping_columns must equal 2.'
) as owner_041_postcheck;
