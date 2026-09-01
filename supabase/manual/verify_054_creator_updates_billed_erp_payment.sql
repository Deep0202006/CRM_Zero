-- OWNER READ-ONLY POSTCHECK. Expected: all booleans true and stale count 0.
select
  to_regprocedure('public.mapping_request_attribution_guard_v1()') is not null as mapping_creator_guard_present,
  exists(select 1 from pg_policies where schemaname='public' and tablename='mapping_requests' and policyname='mapping_requests_creator_update') as mapping_creator_policy_present,
  to_regprocedure('public.call_log_owner_audit_guard_v1()') is not null as call_immutable_guard_present,
  exists(select 1 from pg_policies where schemaname='public' and tablename='call_logs' and policyname='call_logs_update_creator') as call_creator_policy_present,
  not exists(select 1 from pg_policies where schemaname='public' and tablename='call_logs' and policyname in ('call_logs_update_own_or_admin','Call logs strict isolation update')) as call_admin_update_policy_absent,
  to_regprocedure('public.distributor_erp_payment_billing_guard_v1()') is not null as distributor_unbilling_guard_present,
  pg_get_functiondef('public.distributor_erp_payment_status_command_v1(uuid,uuid,text,text,jsonb)'::regprocedure) like '%ERP_PAYMENT_STATUS_REQUIRES_BILLED%' as billed_gate_present,
  exists(select 1 from pg_constraint where conrelid='public.distributor_accounts'::regclass and conname='distributor_erp_payment_requires_billed_check' and convalidated) as billed_invariant_validated,
  (select count(*) from public.distributor_accounts where billing_status is distinct from 'billed' and erp_payment_status is not null) as stale_not_billed_erp_payment;
