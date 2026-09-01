-- OWNER READ-ONLY PRECHECK. Expected: one row with every count = 0 and boundary inputs present.
select
  (select count(*) from public.distributor_accounts where billing_status is distinct from 'billed' and erp_payment_status is not null) as stale_not_billed_erp_payment,
  (select count(*) from public.mapping_requests where status not in ('Pending','Completed')) as invalid_mapping_status,
  (select count(*) from public.mapping_requests where requested_by is null and requested_by_id_snapshot is null) as missing_mapping_creator_audit,
  (select count(*) from public.call_logs where user_id is null or log_id is null or timestamp is null) as missing_call_audit_identity;

select
  to_regprocedure('public.mapping_request_attribution_guard_v1()') is not null as mapping_guard_051_present,
  to_regprocedure('public.distributor_erp_payment_status_command_v1(uuid,uuid,text,text,jsonb)') is not null as erp_payment_command_052_present,
  exists(select 1 from pg_policies where schemaname='public' and tablename='call_logs' and policyname='call_logs_update_own_or_admin') as call_admin_update_policy_present;
