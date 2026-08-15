-- Paste-and-run production postcheck for migration 043. Read only.
select
  (to_regclass('public.pipeline_create_operations') is not null)::int
  + (to_regprocedure('public.pipeline_create_lead_v1(uuid,uuid,uuid,text,text,text,text,text,text,timestamp with time zone)') is not null)::int
  + (to_regprocedure('public.pipeline_normalize_identity_text(text)') is not null)::int
  + (to_regprocedure('public.pipeline_normalize_phone(text)') is not null)::int
  + (to_regprocedure('public.guard_pipeline_lead_creation()') is not null)::int
  + (exists(select 1 from pg_trigger where tgrelid='public.leads'::regclass and tgname='trg_guard_pipeline_lead_creation' and not tgisinternal))::int
  as authority_objects;

select
  has_table_privilege('authenticated', 'public.leads', 'INSERT') as authenticated_direct_insert,
  has_function_privilege('authenticated', 'public.pipeline_create_lead_v1(uuid,uuid,uuid,text,text,text,text,text,text,timestamp with time zone)', 'EXECUTE') as authenticated_direct_execute,
  has_function_privilege('service_role', 'public.pipeline_create_lead_v1(uuid,uuid,uuid,text,text,text,text,text,text,timestamp with time zone)', 'EXECUTE') as service_execute,
  exists(select 1 from pg_policies where schemaname='public' and tablename='leads' and cmd='INSERT') as lead_insert_policy;

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
  (select count(*) from public.leads where public.pipeline_normalize_identity_text(business_name) = 'poojamedicalprovstores') as pooja_matches;
