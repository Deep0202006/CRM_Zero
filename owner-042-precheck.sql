do $$
begin
 if (select count(*) from information_schema.columns where table_schema='public' and table_name='distributor_accounts' and column_name in ('assigned_to','renewal_date','version'))<>3 then raise exception 'Distributor renewal authority is incomplete'; end if;
 if to_regprocedure('public.distributor_status_command_v1(uuid,uuid,text,text,jsonb)') is null then raise exception 'Canonical distributor command is missing'; end if;
 if to_regprocedure('public.distributor_renewals_due_v1(uuid,boolean,integer)') is null then raise exception 'Canonical My Day renewal reader is missing'; end if;
 if to_regprocedure('public.distributor_renewal_metrics_v1(uuid,boolean)') is not null or to_regprocedure('public.distributor_renewals_list_v1(uuid,boolean,text,integer,integer)') is not null then raise exception 'Migration 042 may already be applied; stop and inspect schema state'; end if;
end $$;

select jsonb_build_object(
 'distributor_accounts',count(*),
 'renewal_dates',count(*) filter(where renewal_date is not null),
 'renewal_metrics_function',to_regprocedure('public.distributor_renewal_metrics_v1(uuid,boolean)') is not null,
 'renewal_list_function',to_regprocedure('public.distributor_renewals_list_v1(uuid,boolean,text,integer,integer)') is not null
) as owner_042_precheck
from public.distributor_accounts;
