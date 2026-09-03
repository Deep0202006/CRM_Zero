-- OWNER READ-ONLY PRECHECK. Run in Supabase SQL Editor and retain the result outside Git.
-- Dependency counts are emitted as RETIREMENT_DEPENDENCY notices. This is not an execute script.
begin read only;

do $$
begin
  if (select count(*) from public.users where lower(btrim(name)) in ('ravi', 'prince')) <> 2
     or (select count(*) from public.users where lower(btrim(name)) = 'ravi') <> 1
     or (select count(*) from public.users where lower(btrim(name)) = 'prince') <> 1 then
    raise exception 'RETIREMENT_TARGET_MISMATCH: expected exactly one Ravi and one Prince profile';
  end if;
end
$$;

with retirement_targets as (
  select lower(btrim(name)) as expected_name, user_id, name as profile_name, email, is_active::text
  from public.users
  where lower(btrim(name)) in ('ravi', 'prince')
)
select expected_name, user_id, profile_name, email, is_active
from retirement_targets
order by expected_name;

with retirement_targets as (
  select lower(btrim(name)) as expected_name, user_id
  from public.users
  where lower(btrim(name)) in ('ravi', 'prince')
)
select
  target.expected_name,
  count(auth_user.id)::bigint as auth_user_rows
from retirement_targets target
left join auth.users auth_user on auth_user.id = target.user_id
group by target.expected_name
order by target.expected_name;

do $$
declare
  candidate record;
  target_ids uuid[] := array(
    select user_id
    from public.users
    where lower(btrim(name)) in ('ravi', 'prince')
    order by user_id
  );
  matched bigint;
begin
  for candidate in
    select column.table_schema, column.table_name, column.column_name
    from information_schema.columns column
    join information_schema.tables table_info
      on table_info.table_schema = column.table_schema
     and table_info.table_name = column.table_name
     and table_info.table_type = 'BASE TABLE'
    where column.table_schema in ('public', 'auth')
      and column.data_type = 'uuid'
    order by column.table_schema, column.table_name, column.ordinal_position
  loop
    execute format(
      'select count(*) from %I.%I where %I = any ($1)',
      candidate.table_schema,
      candidate.table_name,
      candidate.column_name
    ) into matched using target_ids;

    if matched > 0 then
      raise notice 'RETIREMENT_DEPENDENCY %.%.% = %',
        candidate.table_schema,
        candidate.table_name,
        candidate.column_name,
        matched;
    end if;
  end loop;
end
$$;

select
  constraint_info.conname as constraint_name,
  source_namespace.nspname as source_schema,
  source_table.relname as source_table,
  pg_get_constraintdef(constraint_info.oid) as definition
from pg_constraint constraint_info
join pg_class source_table on source_table.oid = constraint_info.conrelid
join pg_namespace source_namespace on source_namespace.oid = source_table.relnamespace
where constraint_info.contype = 'f'
  and constraint_info.confrelid = 'public.users'::regclass
order by source_schema, source_table, constraint_name;

rollback;
