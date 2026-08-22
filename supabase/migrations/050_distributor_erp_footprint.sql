begin;

-- Read-only extension of the existing Distributor Status metrics aggregate.
create or replace function public.distributor_status_metrics_v1(p_actor_id uuid,p_admin boolean)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  with scoped as (
    select d.distributor_id,d.erp_id,d.installation_status,d.training_status,d.mapping_status,d.activity_status,d.billing_status
    from public.distributor_accounts d
    where exists(select 1 from public.users u where u.user_id=p_actor_id and u.is_active=true)
      and ((p_admin and public.receivables_is_admin(p_actor_id)) or (not p_admin and d.assigned_to=p_actor_id))
  ), summary as (
    select count(*) total,
      count(*) filter(where installation_status<>'done') installation_pending,
      count(*) filter(where installation_status='done' and training_status<>'done') training_pending,
      count(*) filter(where installation_status='done' and training_status='done') installation_training_done,
      count(*) filter(where installation_status='done' and training_status='done' and mapping_status='done') mapped,
      count(*) filter(where activity_status='active') active,
      count(*) filter(where activity_status='inactive') inactive,
      count(*) filter(where billing_status='billed') billed
    from scoped
  ), categories as (
    select s.erp_id,e.erp_name,count(*)::integer count
    from scoped s left join public.erp_systems e on e.erp_id=s.erp_id
    group by s.erp_id,e.erp_name
  )
  select jsonb_build_object(
    'total',summary.total,
    'installation_pending',summary.installation_pending,
    'training_pending',summary.training_pending,
    'installation_training_done',summary.installation_training_done,
    'mapped',summary.mapped,
    'active',summary.active,
    'inactive',summary.inactive,
    'billed',summary.billed,
    'erp_distribution',coalesce((select jsonb_agg(jsonb_build_object('erp_id',erp_id,'erp_name',erp_name,'count',count) order by (erp_id is null),count desc,erp_name asc nulls last,erp_id::text) from categories),'[]'::jsonb)
  ) from summary
$$;

revoke all on function public.distributor_status_metrics_v1(uuid,boolean) from public,anon,authenticated;
grant execute on function public.distributor_status_metrics_v1(uuid,boolean) to service_role;

commit;
