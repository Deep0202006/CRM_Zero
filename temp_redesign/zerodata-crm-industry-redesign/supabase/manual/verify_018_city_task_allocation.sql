-- Read-only verification for migration 018. Run after pasting 018 in Supabase SQL Editor.
select
  to_regprocedure(
    'public.allocate_city_task_batch(text,text,jsonb,jsonb)'
  ) as allocation_function;

select
  p.prosecdef as security_definer,
  p.proconfig as function_configuration
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'allocate_city_task_batch';

select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'allocated_targets'
  and indexname = 'idx_alloc_targets_compound';

select
  has_function_privilege(
    'authenticated',
    'public.allocate_city_task_batch(text,text,jsonb,jsonb)',
    'EXECUTE'
  ) as authenticated_can_execute,
  has_function_privilege(
    'anon',
    'public.allocate_city_task_batch(text,text,jsonb,jsonb)',
    'EXECUTE'
  ) as anon_can_execute;
