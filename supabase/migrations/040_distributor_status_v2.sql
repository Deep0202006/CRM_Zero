create or replace function public.distributor_status_metrics_v1(p_actor_id uuid,p_admin boolean)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 select jsonb_build_object(
  'total',count(*),
  'installation_pending',count(*) filter(where installation_status='pending'),
  'training_pending',count(*) filter(where installation_status='done' and training_status='pending'),
  'installation_training_done',count(*) filter(where installation_status='done' and training_status='done'),
  'active',count(*) filter(where installation_status='done' and training_status='done' and activity_status='active'),
  'inactive',count(*) filter(where installation_status='done' and training_status='done' and activity_status='inactive'),
  'billed',count(*) filter(where billing_status='billed')
 ) from public.distributor_accounts where exists(select 1 from public.users u where u.user_id=p_actor_id and u.is_active=true) and ((p_admin and public.receivables_is_admin(p_actor_id)) or (not p_admin and assigned_to=p_actor_id))
$$;
