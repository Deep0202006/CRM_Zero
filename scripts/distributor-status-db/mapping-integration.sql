\set ON_ERROR_STOP on
set role service_role;

do $$
begin
 if exists(select 1 from public.distributor_accounts where mapping_status is not null) then raise exception 'migration fabricated historical mapping truth'; end if;
end $$;

do $$
declare result jsonb;
begin
 result:=public.distributor_status_command_v1(
  '30000000-0000-4000-a000-000000000050','10000000-0000-4000-a000-000000000001','create',repeat('1',64),
  jsonb_build_object('distributor_id','40000000-0000-4000-a000-000000000050','distributor_name','Mapped Contract','distributor_reference','MAP-50','identity_key','code:map-50','lead_id','','phone','','city','','assigned_to','20000000-0000-4000-a000-000000000001','installation_status','done','installation_completed_at',current_date::text,'training_status','done','training_completed_at',current_date::text,'mapping_status','pending','mapped_at','','activity_status','active','billing_status','not_billed','billed_at','','bill_reference','','renewal_date',(current_date+2)::text,'note','mapping fixture'));
 if not coalesce((result->>'success')::boolean,false) then raise exception 'current create failed: %',result; end if;
 if (result#>>'{record,mapping_status}')<>'pending' then raise exception 'new mapping default contract failed: %',result; end if;
end $$;

do $$
begin
 begin
  update public.distributor_accounts set mapping_status='done' where distributor_id='40000000-0000-4000-a000-000000000040';
  raise exception 'mapped before prerequisites accepted';
 exception when check_violation then null; end;
end $$;

do $$
declare result jsonb; current_version bigint;
begin
 select version into current_version from public.distributor_accounts where distributor_id='40000000-0000-4000-a000-000000000050';
 result:=public.distributor_status_command_v1(
  '30000000-0000-4000-a000-000000000051','10000000-0000-4000-a000-000000000001','update',repeat('2',64),
  jsonb_build_object('distributor_id','40000000-0000-4000-a000-000000000050','expected_version',current_version,'distributor_name','Mapped Contract','distributor_reference','MAP-50','identity_key','code:map-50','lead_id','','phone','','city','','assigned_to','20000000-0000-4000-a000-000000000001','installation_status','done','installation_completed_at',current_date::text,'training_status','done','training_completed_at',current_date::text,'mapping_status','done','mapped_at',current_date::text,'activity_status','active','billing_status','billed','billed_at',current_date::text,'bill_reference','B-50','renewal_date',(current_date+2)::text,'note','mapped'));
 if not coalesce((result->>'success')::boolean,false) or result#>>'{record,mapping_status}'<>'done' then raise exception 'mapped update failed: %',result; end if;
 if (public.distributor_status_metrics_v1('10000000-0000-4000-a000-000000000001',true)->>'mapped')::integer<>1 then raise exception 'mapped metric failed'; end if;
end $$;

-- Scale rows are disposable fixtures. Give a representative subset explicit
-- mapping truth so the 10k Mapped projection/filter plan is exercised without
-- changing the migration's no-backfill contract.
update public.distributor_accounts
set mapping_status='done', mapped_at=current_date
where distributor_name like 'Scale %' and mod(hashtext(identity_key)::bigint,4)=0;

do $$
declare rows jsonb; result jsonb; replay jsonb;
begin
 select jsonb_agg(jsonb_build_object(
  'rowNumber',n+1,'classification','NEW','payload',jsonb_build_object(
   'distributor_id',gen_random_uuid(),'distributor_name','Mapped Import '||n,
   'distributor_reference','MIMP-'||n,'identity_key','code:mimp-'||n,
   'assigned_to','20000000-0000-4000-a000-000000000001',
   'installation_status','done','installation_completed_at',current_date::text,
   'training_status','done','training_completed_at',current_date::text,
   'mapping_status',case when n%2=0 then 'done' else 'pending' end,
   'mapped_at',case when n%2=0 then current_date::text else null end,
   'activity_status','active','billing_status','not_billed','billed_at',null,
   'bill_reference','','renewal_date',(current_date+(n%30))::text
  )) order by n) into rows from generate_series(1,100)n;
 result:=public.import_distributor_status_v1('30000000-0000-4000-a000-000000000053','10000000-0000-4000-a000-000000000001',repeat('6',64),'mapped-scale.xlsx',rows);
 replay:=public.import_distributor_status_v1('30000000-0000-4000-a000-000000000053','10000000-0000-4000-a000-000000000001',repeat('6',64),'mapped-scale.xlsx',rows);
 if (result->>'created_count')::integer<>100 or replay<>result then raise exception '10k mapped import/idempotency failed: %, %',result,replay; end if;
end $$;

do $$
declare result jsonb; replay jsonb; denied jsonb; stale jsonb; current_version bigint;
begin
 select version into current_version from public.distributor_accounts where distributor_id='40000000-0000-4000-a000-000000000050';
 result:=public.distributor_status_command_v1('30000000-0000-4000-a000-000000000052','20000000-0000-4000-a000-000000000001','renew',repeat('3',64),jsonb_build_object('distributor_id','40000000-0000-4000-a000-000000000050','expected_version',current_version,'renewal_date',(current_date-1)::text,'note','manual correction'));
 replay:=public.distributor_status_command_v1('30000000-0000-4000-a000-000000000052','20000000-0000-4000-a000-000000000001','renew',repeat('3',64),jsonb_build_object('distributor_id','40000000-0000-4000-a000-000000000050','expected_version',current_version,'renewal_date',(current_date-1)::text,'note','manual correction'));
 denied:=public.distributor_status_command_v1(gen_random_uuid(),'20000000-0000-4000-a000-000000000002','renew',repeat('4',64),jsonb_build_object('distributor_id','40000000-0000-4000-a000-000000000050','expected_version',current_version+1,'renewal_date',current_date::text,'note','wrong owner'));
 stale:=public.distributor_status_command_v1(gen_random_uuid(),'20000000-0000-4000-a000-000000000001','renew',repeat('5',64),jsonb_build_object('distributor_id','40000000-0000-4000-a000-000000000050','expected_version',current_version,'renewal_date',current_date::text,'note','stale'));
 if not coalesce((result->>'success')::boolean,false) or replay<>result then raise exception 'employee renewal/idempotency failed: %, %',result,replay; end if;
 if denied->>'code'<>'DISTRIBUTOR_NOT_ASSIGNED' or stale->>'code'<>'DISTRIBUTOR_CONFLICT' then raise exception 'renewal authorization/concurrency failed: %, %',denied,stale; end if;
 if (public.distributor_renewals_due_v1('20000000-0000-4000-a000-000000000001',false,5)->>'total')::integer<1 then raise exception 'My Day renewal projection failed'; end if;
end $$;

do $$
begin
 if exists(select 1 from protected_writes where writes<>0) then raise exception 'cross-domain write'; end if;
 if (select count(*) from public.distributor_accounts where mapping_status='done')<2000 then raise exception '10k mapped fixture was not representative'; end if;
end $$;

\echo DISTRIBUTOR_MAPPED_FILTER_QUERY_PLAN
explain (analyze,buffers,format text) select distributor_id from public.distributor_accounts where installation_status='done' and training_status='done' and mapping_status='done' order by updated_at desc limit 50;
\echo DISTRIBUTOR_MAPPED_METRICS_QUERY_PLAN
explain (analyze,buffers,format text) select public.distributor_status_metrics_v1('10000000-0000-4000-a000-000000000001',true);
select 'Distributor Mapped and employee renewal integration passed.';
