-- READ ONLY. Run manually after Migration 048.
select column_name,is_nullable from information_schema.columns where table_schema='public' and table_name='field_visits' and column_name in ('erp_id','erp_usage_state') order by column_name;
select conname,pg_get_constraintdef(oid) from pg_constraint where conrelid='public.field_visits'::regclass and conname='field_visits_erp_observation_valid';
select count(*) filter(where erp_id is null and erp_usage_state is null) as historical_not_captured, count(*) filter(where erp_id is not null or erp_usage_state is not null) as unexpected_backfill from public.field_visits;
select has_function_privilege('anon','public.confirm_field_visit_erp_v1(uuid,jsonb)','execute') as anon_execute, has_function_privilege('authenticated','public.confirm_field_visit_erp_v1(uuid,jsonb)','execute') as authenticated_execute, has_function_privilege('service_role','public.confirm_field_visit_erp_v1(uuid,jsonb)','execute') as service_execute;
select indexname,indexdef from pg_indexes where schemaname='public' and tablename='field_visits' and indexname='field_visits_erp_latest_business_idx';
-- Expected: 335 historical not-captured rows and 0 unexpected backfill; only service_role can execute the write function.
