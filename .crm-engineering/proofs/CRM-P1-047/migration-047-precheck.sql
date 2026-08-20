-- CRM-P1-047 Owner precheck: read-only and safe before Migration 047.
select jsonb_build_object(
  'checked_at', now(),
  'server_version', current_setting('server_version'),
  'migration_046_authority_present',
    exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='receivable_payments' and column_name='import_key'
    )
    and to_regclass('public.distributor_master_import_batches') is not null
    and to_regprocedure('public.resolve_distributor_master_receivables_v1(jsonb)') is not null
    and to_regprocedure('public.resolve_distributor_master_payment_targets_v1(jsonb)') is not null
    and to_regprocedure('public.apply_distributor_master_payments_v1(uuid,jsonb)') is not null
    and to_regprocedure('public.import_distributor_master_v1(uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb)') is not null,
  'migration_047_absent',
    to_regclass('public.erp_systems') is null
    and to_regclass('public.erp_partner_scopes') is null
    and not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='distributor_accounts' and column_name='erp_id'
    )
    and not exists(select 1 from public.capabilities where code='erp_partner_viewer'),
  'erp_partner_capability_assignments',
    (select count(*) from public.user_capabilities where capability_code='erp_partner_viewer'),
  'distributor_rows', (select count(*) from public.distributor_accounts),
  'receivable_rows', (select count(*) from public.receivables),
  'payment_rows', (select count(*) from public.receivable_payments),
  'confirmed_collected', (
    select coalesce(sum(amount),0)
    from public.receivable_payments
    where verification_status='confirmed' and reversed_at is null
  )
) as precheck;
