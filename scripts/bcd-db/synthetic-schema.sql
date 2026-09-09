-- Synthetic fixture roles/grants and assertions, never a database export.
-- The runner loads existing authoritative table definitions.
do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to service_role;
grant select on public.users, public.leads, public.field_visits to service_role;

-- Fail closed if a tracked definition/extraction changes or silently produces no SQL.
do $$ begin
  if not (select rolbypassrls from pg_roles where rolname='service_role') then raise exception 'FIXTURE_SERVICE_ROLE_RLS'; end if;
  if not (select relrowsecurity from pg_class where oid='public.field_visits'::regclass) then raise exception 'FIXTURE_VISIT_RLS'; end if;
  if to_regclass('public.idx_field_visits_user_date') is null or to_regclass('public.idx_field_visits_lead_id') is null then raise exception 'FIXTURE_TRACKED_INDEX_MISSING'; end if;
  if not (select indisvalid and indnkeyatts=2 from pg_index where indexrelid='public.idx_field_visits_user_date'::regclass)
    or pg_get_indexdef('public.idx_field_visits_user_date'::regclass,1,true)<>'user_id'
    or pg_get_indexdef('public.idx_field_visits_user_date'::regclass,2,true)<>'visit_date'
    or not (select indisvalid and indnkeyatts=1 from pg_index where indexrelid='public.idx_field_visits_lead_id'::regclass)
    or pg_get_indexdef('public.idx_field_visits_lead_id'::regclass,1,true)<>'lead_id' then raise exception 'FIXTURE_TRACKED_INDEX_DEFINITION'; end if;
  if not exists(select 1 from pg_constraint where conrelid='public.field_visits'::regclass and confrelid='public.users'::regclass and contype='f'
    and conkey=array[(select attnum from pg_attribute where attrelid='public.field_visits'::regclass and attname='user_id')]) then raise exception 'FIXTURE_VISIT_USER_FK'; end if;
  if exists(select 1 from pg_constraint where conrelid='public.field_visits'::regclass and confrelid='public.leads'::regclass and contype='f') then raise exception 'UNSUPPORTED_VISIT_LEAD_FK_ASSUMPTION'; end if;
  if exists(select 1 from (values ('visit_id','uuid'),('user_id','uuid'),('lead_id','text'),('visit_date','date'),('check_in_time','timestamp with time zone'),
    ('visit_outcome','text'),('segment_type','text'),('visit_notes','text'),('person_met','text'),('address','text')) expected(name,type)
    left join information_schema.columns c on c.table_schema='public' and c.table_name='field_visits' and c.column_name=expected.name
    where c.data_type is distinct from expected.type) then raise exception 'FIXTURE_VISIT_COLUMN_TYPES'; end if;
end $$;
