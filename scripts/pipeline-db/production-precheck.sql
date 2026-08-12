-- READ ONLY. Save this single aggregate row before owner applies 037 then 038.
select
  (select count(*) from public.leads) as total_leads,
  (select md5(string_agg(lead_id::text, ',' order by lead_id)) from public.leads) as lead_ids_fingerprint,
  (select count(*) from public.leads where segment_type::text='Retailer' and status::text='Payment') as retailer_payment_target,
  (select count(*) from public.leads where segment_type::text='Retailer' and status::text='Converted') as retailer_converted_before,
  (select count(*) from public.leads where segment_type::text='Distributor' and status::text='Payment') as distributor_payment,
  (select md5(string_agg(lead_id::text || ':' || status::text, ',' order by lead_id)) from public.leads where not (segment_type::text='Retailer' and status::text='Payment')) as non_target_stage_fingerprint,
  (select count(*) from public.pipeline_transition_operations) as transition_history,
  (select count(*) from public.tasks where status::text in ('Pending','In Progress') and related_lead_id is not null and assigned_by is null and source::text='manual' and ((description ~ '^Lead moved to (Contacted|Interested|Not Interested|Registration|Installation|Payment|Converted|Renewal Due)\. Follow up before it goes stale\.$' and title ~ '^Follow up: .+ \((Contacted|Interested|Not Interested|Registration|Installation|Payment|Converted|Renewal Due)\)$') or (description='Required for registration.' and (title like 'Collect GST certificate:%' or title like 'Collect PAN card:%' or title like 'Collect Drug Licence:%' or title like 'Collect Bill Photo:%')))) as proven_pipeline_active_tasks,
  (select count(*) from public.users) as users,
  (select count(*) from public.call_logs) as calls,
  (select count(*) from public.field_visits) as field_visits,
  (select count(*) from public.receivables) as receivables,
  (select count(*) from public.receivable_payments) as receivable_payments;
