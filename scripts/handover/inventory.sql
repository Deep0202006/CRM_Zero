begin read only;
select jsonb_build_object(
  'database', jsonb_build_object('postgresVersion', current_setting('server_version'), 'timezone', current_setting('TimeZone'), 'bytes', pg_database_size(current_database())),
  'objects', jsonb_build_object(
    'schemaCount', (select count(*) from pg_namespace where nspname !~ '^pg_' and nspname <> 'information_schema'),
    'publicTables', (select coalesce(jsonb_agg(relname order by relname), '[]') from pg_class join pg_namespace on pg_namespace.oid=relnamespace where nspname='public' and relkind='r'),
    'viewCount', (select count(*) from pg_class join pg_namespace on pg_namespace.oid=relnamespace where nspname='public' and relkind in ('v','m')),
    'sequenceCount', (select count(*) from pg_class join pg_namespace on pg_namespace.oid=relnamespace where nspname='public' and relkind='S'),
    'constraints', (select coalesce(jsonb_agg(jsonb_build_object('table',rel.relname,'constraint',con.conname,'type',con.contype) order by rel.relname,con.conname),'[]') from pg_constraint con join pg_class rel on rel.oid=con.conrelid join pg_namespace ns on ns.oid=rel.relnamespace where ns.nspname='public'),
    'indexes', (select coalesce(jsonb_agg(jsonb_build_object('table',tab.relname,'index',idx.relname,'unique',ind.indisunique) order by tab.relname,idx.relname),'[]') from pg_index ind join pg_class idx on idx.oid=ind.indexrelid join pg_class tab on tab.oid=ind.indrelid join pg_namespace ns on ns.oid=tab.relnamespace where ns.nspname='public'),
    'functions', (select coalesce(jsonb_agg(jsonb_build_object('function',p.proname,'signature',pg_get_function_identity_arguments(p.oid),'securityDefiner',p.prosecdef) order by p.proname,pg_get_function_identity_arguments(p.oid)),'[]') from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public'),
    'triggers', (select coalesce(jsonb_agg(jsonb_build_object('table',rel.relname,'trigger',tg.tgname,'enabled',tg.tgenabled) order by rel.relname,tg.tgname),'[]') from pg_trigger tg join pg_class rel on rel.oid=tg.tgrelid join pg_namespace ns on ns.oid=rel.relnamespace where ns.nspname='public' and not tg.tgisinternal),
    'rls', (select coalesce(jsonb_agg(jsonb_build_object('table',rel.relname,'enabled',rel.relrowsecurity,'forced',rel.relforcerowsecurity) order by rel.relname),'[]') from pg_class rel join pg_namespace ns on ns.oid=rel.relnamespace where ns.nspname='public' and rel.relkind='r'),
    'policies', (select coalesce(jsonb_agg(jsonb_build_object('table',tablename,'policy',policyname,'command',cmd,'roles',roles) order by tablename,policyname),'[]') from pg_policies where schemaname='public'),
    'grants', (select coalesce(jsonb_agg(jsonb_build_object('table',table_name,'grantee',grantee,'privilege',privilege_type) order by table_name,grantee,privilege_type),'[]') from information_schema.role_table_grants where table_schema='public')
  ),
  'realtime', jsonb_build_object(
    'publications', (select coalesce(jsonb_agg(pubname order by pubname),'[]') from pg_publication),
    'membership', (select coalesce(jsonb_agg(jsonb_build_object('publication',pubname,'schema',schemaname,'table',tablename) order by pubname,schemaname,tablename),'[]') from pg_publication_tables)
  ),
  'cron', jsonb_build_object(
    'jobs', (select coalesce(jsonb_agg(jsonb_build_object('id',jobid,'job',jobname,'schedule',schedule,'active',active,'classification',case when command ilike '%daily_kpi_snapshots%' then 'KNOWN_LIVE_DEFECT' else 'NORMAL' end) order by jobid),'[]') from cron.job),
    'recentStatus', (select coalesce(jsonb_agg(jsonb_build_object('jobId',jobid,'status',case when status='succeeded' then 'SUCCESS' when status in ('failed','failure') then 'FAILURE' else 'OTHER' end) order by jobid),'[]') from (select distinct on (jobid) jobid,status from cron.job_run_details order by jobid,start_time desc) recent)
  ),
  'extensions', (select coalesce(jsonb_agg(jsonb_build_object('extension',extname,'version',extversion) order by extname),'[]') from pg_extension),
  'auth', jsonb_build_object('userCount',(select count(*) from auth.users),'identityProviders',(select coalesce(jsonb_agg(jsonb_build_object('provider',provider,'count',count) order by provider),'[]') from (select provider,count(*) from auth.identities group by provider) providers),'schemaMigrationVersion',(select max(version)::text from auth.schema_migrations)),
  'storage', jsonb_build_object('schemaMigrationVersion',(select max(id)::text from storage.migrations),'buckets',(select coalesce(jsonb_agg(jsonb_build_object('bucket',id,'public',public,'fileSizeLimit',file_size_limit,'allowedMimeTypes',allowed_mime_types) order by id),'[]') from storage.buckets),'objectCount',(select count(*) from storage.objects),'objectBytes',(select coalesce(sum((metadata->>'size')::bigint),0) from storage.objects)),
  'realtimeSchemaMigrationVersion',(select max(version)::text from realtime.schema_migrations),
  'criticalRows', jsonb_build_object('distributorAccounts',(select count(*) from public.distributor_accounts),'receivables',(select count(*) from public.receivables),'receivablePayments',(select count(*) from public.receivable_payments),'calls',(select count(*) from public.call_logs),'fieldVisits',(select count(*) from public.field_visits),'attendance',(select count(*) from public.attendance),'leads',(select count(*) from public.leads),'chatMessages',(select count(*) from public.chat_messages),'fieldVisitMedia',(select count(*) from public.field_visit_media)),
  'financialAggregates', jsonb_build_object('billed',(select coalesce(sum(bill_amount),0) from public.receivables),'confirmedPayments',(select coalesce(sum(amount) filter(where verification_status='confirmed'),0) from public.receivable_payments),'outstanding',(select coalesce(sum(outstanding_amount),0) from public.receivables_financial_read_v1)),
  'databaseMediaFallbackBytes', pg_total_relation_size('public.field_visit_media')
) as inventory;
commit;
