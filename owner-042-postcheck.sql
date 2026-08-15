do $$
begin
 if to_regprocedure('public.distributor_renewal_metrics_v1(uuid,boolean)') is null then raise exception 'distributor_renewal_metrics_v1 is missing'; end if;
 if to_regprocedure('public.distributor_renewals_list_v1(uuid,boolean,text,integer,integer)') is null then raise exception 'distributor_renewals_list_v1 is missing'; end if;
 if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('distributor_renewal_metrics_v1','distributor_renewals_list_v1'))<>2 then raise exception 'Unexpected renewal read function shape'; end if;
 if has_function_privilege('anon','public.distributor_renewal_metrics_v1(uuid,boolean)','EXECUTE') then raise exception 'anon can execute renewal metrics'; end if;
 if has_function_privilege('authenticated','public.distributor_renewals_list_v1(uuid,boolean,text,integer,integer)','EXECUTE') then raise exception 'authenticated can execute renewal list'; end if;
 if not has_function_privilege('service_role','public.distributor_renewal_metrics_v1(uuid,boolean)','EXECUTE') then raise exception 'service_role cannot execute renewal metrics'; end if;
end $$;

select jsonb_build_object(
 'renewal_read_functions',(
  select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('distributor_renewal_metrics_v1','distributor_renewals_list_v1')
 ),
 'distributor_accounts',count(*),
 'renewal_dates',count(*) filter(where renewal_date is not null)
) as owner_042_postcheck
from public.distributor_accounts;
