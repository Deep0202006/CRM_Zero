-- CRM-P1-046 owner precheck: read-only, safe before Migration 046.
select jsonb_build_object(
  'checked_at', now(),
  'server_version', current_setting('server_version'),
  'migration_046_absent',
    not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='receivable_payments' and column_name='import_key'
    )
    and to_regclass('public.distributor_master_import_batches') is null
    and to_regprocedure('public.import_distributor_master_v1(uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb)') is null,
  'migration_045_authority_present',
    to_regclass('public.receivables') is not null
    and to_regclass('public.receivable_payments') is not null
    and to_regclass('public.distributor_accounts') is not null
    and to_regprocedure('public.import_receivables_v1(uuid,uuid,text,text,text,jsonb)') is not null
    and to_regprocedure('public.distributor_status_command_v1(uuid,uuid,text,text,jsonb)') is not null,
  'receivable_payment_rows', (select count(*) from public.receivable_payments),
  'receivable_rows', (select count(*) from public.receivables),
  'distributor_rows', (select count(*) from public.distributor_accounts)
) as precheck;
