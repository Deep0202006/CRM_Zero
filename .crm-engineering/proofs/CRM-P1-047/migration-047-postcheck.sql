-- CRM-P1-047 Owner postcheck: read-only and safe after Migration 047.
select jsonb_build_object(
  'erp_systems', jsonb_build_object(
    'present', to_regclass('public.erp_systems') is not null,
    'rls', (select relrowsecurity from pg_class where oid=to_regclass('public.erp_systems')),
    'rows', (select count(*) from public.erp_systems),
    'anon_select', has_table_privilege('anon','public.erp_systems','select'),
    'authenticated_select', has_table_privilege('authenticated','public.erp_systems','select'),
    'service_role_select', has_table_privilege('service_role','public.erp_systems','select')
  ),
  'distributor_erp', jsonb_build_object(
    'column', exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='distributor_accounts'
        and column_name='erp_id' and data_type='uuid' and is_nullable='YES'
    ),
    'assigned_rows', (select count(*) from public.distributor_accounts where erp_id is not null),
    'foreign_key', exists (
      select 1 from pg_constraint
      where conrelid='public.distributor_accounts'::regclass
        and confrelid='public.erp_systems'::regclass
        and contype='f'
    ),
    'listing_index_valid', (select indisvalid from pg_index where indexrelid='public.distributor_erp_updated_idx'::regclass),
    'renewal_index_valid', (select indisvalid from pg_index where indexrelid='public.distributor_erp_renewal_idx'::regclass)
  ),
  'erp_partner_scope', jsonb_build_object(
    'present', to_regclass('public.erp_partner_scopes') is not null,
    'rls', (select relrowsecurity from pg_class where oid=to_regclass('public.erp_partner_scopes')),
    'rows', (select count(*) from public.erp_partner_scopes),
    'anon_select', has_table_privilege('anon','public.erp_partner_scopes','select'),
    'authenticated_select', has_table_privilege('authenticated','public.erp_partner_scopes','select'),
    'service_role_select', has_table_privilege('service_role','public.erp_partner_scopes','select')
  ),
  'capability', jsonb_build_object(
    'definition', exists(select 1 from public.capabilities where code='erp_partner_viewer'),
    'assignments', (select count(*) from public.user_capabilities where capability_code='erp_partner_viewer'),
    'exclusive_trigger', exists (
      select 1 from pg_trigger
      where tgrelid='public.user_capabilities'::regclass
        and tgname='erp_partner_capability_guard_v1' and tgenabled<>'D'
    )
  ),
  'service_only_functions', jsonb_build_object(
    'resolve_erp',
      not has_function_privilege('anon','public.resolve_or_create_erp_system_v1(uuid,text)','execute')
      and not has_function_privilege('authenticated','public.resolve_or_create_erp_system_v1(uuid,text)','execute')
      and has_function_privilege('service_role','public.resolve_or_create_erp_system_v1(uuid,text)','execute'),
    'scope_management',
      not has_function_privilege('anon','public.set_erp_partner_scopes_v1(uuid,uuid,jsonb)','execute')
      and not has_function_privilege('authenticated','public.set_erp_partner_scopes_v1(uuid,uuid,jsonb)','execute')
      and has_function_privilege('service_role','public.set_erp_partner_scopes_v1(uuid,uuid,jsonb)','execute'),
    'distributor_projection',
      not has_function_privilege('anon','public.erp_partner_distributors_v1(uuid,uuid,text,integer,integer)','execute')
      and not has_function_privilege('authenticated','public.erp_partner_distributors_v1(uuid,uuid,text,integer,integer)','execute')
      and has_function_privilege('service_role','public.erp_partner_distributors_v1(uuid,uuid,text,integer,integer)','execute'),
    'renewal_projection',
      not has_function_privilege('anon','public.erp_partner_renewals_v1(uuid,uuid,text,integer,integer)','execute')
      and not has_function_privilege('authenticated','public.erp_partner_renewals_v1(uuid,uuid,text,integer,integer)','execute')
      and has_function_privilege('service_role','public.erp_partner_renewals_v1(uuid,uuid,text,integer,integer)','execute')
  ),
  'business_state', jsonb_build_object(
    'distributor_rows', (select count(*) from public.distributor_accounts),
    'receivable_rows', (select count(*) from public.receivables),
    'payment_rows', (select count(*) from public.receivable_payments),
    'confirmed_collected', (
      select coalesce(sum(amount),0)
      from public.receivable_payments
      where verification_status='confirmed' and reversed_at is null
    )
  )
) as postcheck;
