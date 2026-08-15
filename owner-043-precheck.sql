-- Paste-and-run production precheck for migration 043. Read only.
select
  (select count(*) from public.leads) as leads,
  (select count(*) from public.users) as users,
  (select count(*) from public.call_logs) as calls,
  (select count(*) from public.attendance) as attendance,
  (select count(*) from public.field_visits) as field_visits,
  (select count(*) from public.tasks) as tasks,
  (select count(*) from public.receivables) as receivables,
  (select count(*) from public.receivable_payments) as receivable_payments,
  (select count(*) from public.distributor_accounts) as distributor_accounts,
  (select count(*) from public.leads where regexp_replace(lower(coalesce(business_name, '')), '[^a-z0-9]+', '', 'g') = 'poojamedicalprovstores') as pooja_matches;

select
  to_regclass('public.pipeline_create_operations') as create_operations,
  to_regprocedure('public.pipeline_create_lead_v1(uuid,uuid,uuid,text,text,text,text,text,text,timestamp with time zone)') as create_function;
