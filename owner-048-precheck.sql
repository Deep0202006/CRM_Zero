-- READ ONLY. Run manually in Supabase SQL Editor before Migration 048.
select to_regclass('supabase_migrations.schema_migrations') as supabase_migration_history_relation;
select exists(select 1 from information_schema.tables where table_schema='public' and table_name='erp_systems') as erp_directory_present;
select column_name from information_schema.columns where table_schema='public' and table_name='field_visits' and column_name in ('erp_id','erp_usage_state');
select segment_type,count(*) from public.field_visits group by segment_type order by segment_type;
select count(*) as erp_directory_count from public.erp_systems;
-- Expected: 047 is the Owner immutable boundary, both Field Visit ERP columns absent,
-- and historical Field Visit counts remain 323 Retailer / 12 Distributor (335 total).
