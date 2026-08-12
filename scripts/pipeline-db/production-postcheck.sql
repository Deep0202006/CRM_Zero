-- READ ONLY. Compare fingerprints/counts with saved PRECHECK output.
select
  (select count(*) from public.leads) as total_leads_must_match,
  (select md5(string_agg(lead_id::text, ',' order by lead_id)) from public.leads) as lead_ids_fingerprint_must_match,
  (select count(*) from public.leads where segment_type::text='Retailer' and status::text='Payment') as retailer_payment_must_be_zero,
  (select count(*) from public.leads where segment_type::text='Retailer' and status::text='Converted') as retailer_converted_after,
  (select count(*) from public.leads where segment_type::text='Distributor' and status::text='Payment') as distributor_payment_must_match,
  (select md5(string_agg(lead_id::text || ':' || status::text, ',' order by lead_id)) from public.leads where not (segment_type::text='Retailer' and status::text='Converted' and exists (select 1 from public.pipeline_transition_operations o where o.lead_id=leads.lead_id and o.event_kind='system_correction' and o.reason='retailer_payment_stage_removed'))) as non_target_stage_fingerprint_must_match,
  (select count(*) from public.pipeline_transition_operations where event_kind='system_correction' and reason='retailer_payment_stage_removed') as correction_audits_must_equal_target,
  (select count(*) from public.tasks where cancellation_reason='pipeline_automatic_work_removed' and is_active=false) as pipeline_tasks_archived,
  (select count(*) from public.users) as users_must_match,
  (select count(*) from public.call_logs) as calls_must_match,
  (select count(*) from public.field_visits) as field_visits_must_match,
  (select count(*) from public.receivables) as receivables_must_match,
  (select count(*) from public.receivable_payments) as receivable_payments_must_match;
