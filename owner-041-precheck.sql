-- Read-only precheck. Capture this single aggregate row before applying owner-041.sql.
select jsonb_build_object(
 'users',(select count(*) from public.users),
 'leads',(select count(*) from public.leads),
 'calls',(select count(*) from public.call_logs),
 'attendance',(select count(*) from public.attendance),
 'field_visits',(select count(*) from public.field_visits),
 'tasks',(select count(*) from public.tasks),
 'receivables',(select count(*) from public.receivables),
 'receivable_payments',(select count(*) from public.receivable_payments),
 'distributor_accounts',(select count(*) from public.distributor_accounts),
 'distributor_events',(select count(*) from public.distributor_status_events),
 'distributor_states',(select jsonb_build_object(
   'installation_pending',count(*) filter(where installation_status<>'done'),
   'training_pending',count(*) filter(where installation_status='done' and training_status<>'done'),
   'installation_training_done',count(*) filter(where installation_status='done' and training_status='done'),
   'active',count(*) filter(where activity_status='active'),
   'inactive',count(*) filter(where activity_status='inactive'),
   'billed',count(*) filter(where billing_status='billed')
  ) from public.distributor_accounts)
) as owner_041_precheck;
