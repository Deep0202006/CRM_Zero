-- CRM-P1-046 owner postcheck: read-only, safe after Migration 046.
select jsonb_build_object(
  'import_key', (
    select jsonb_build_object('data_type',data_type,'nullable',is_nullable)
    from information_schema.columns
    where table_schema='public' and table_name='receivable_payments' and column_name='import_key'
  ),
  'payment_import_index', (
    select jsonb_build_object('unique',i.indisunique,'valid',i.indisvalid,'predicate',pg_get_expr(i.indpred,i.indrelid))
    from pg_index i join pg_class c on c.oid=i.indexrelid
    where c.oid='public.receivable_payments_import_key_uidx'::regclass
  ),
  'batch_table_rls', (
    select relrowsecurity from pg_class where oid='public.distributor_master_import_batches'::regclass
  ),
  'master_function_present',
    to_regprocedure('public.import_distributor_master_v1(uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb)') is not null,
  'resolver_functions_present',
    to_regprocedure('public.resolve_distributor_master_receivables_v1(jsonb)') is not null
    and to_regprocedure('public.resolve_distributor_master_payment_targets_v1(jsonb)') is not null
    and to_regprocedure('public.apply_distributor_master_payments_v1(uuid,jsonb)') is not null,
  'existing_payments_not_backfilled',
    not exists(select 1 from public.receivable_payments where import_key is not null)
) as postcheck;
