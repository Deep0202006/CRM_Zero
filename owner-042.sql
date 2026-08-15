begin;

create or replace function public.distributor_renewal_metrics_v1(p_actor_id uuid,p_admin boolean)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 with actor as materialized (
  select public.receivables_is_admin(p_actor_id) is_admin
  from public.users where user_id=p_actor_id and is_active=true
 ), authorized as (
  select d.renewal_date
  from public.distributor_accounts d
  cross join actor a
  where (p_admin and a.is_admin) or (not p_admin and d.assigned_to=p_actor_id)
 ), today as (select (now() at time zone 'Asia/Kolkata')::date business_date)
 select jsonb_build_object(
  'overdue',count(*) filter(where renewal_date<business_date),
  'today',count(*) filter(where renewal_date=business_date),
  'tomorrow',count(*) filter(where renewal_date=business_date+1),
  'in_two_days',count(*) filter(where renewal_date=business_date+2)
 ) from authorized cross join today
$$;

create or replace function public.distributor_renewals_list_v1(p_actor_id uuid,p_admin boolean,p_filter text default 'all',p_page integer default 1,p_page_size integer default 50)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
 with actor as materialized (
  select public.receivables_is_admin(p_actor_id) is_admin
  from public.users where user_id=p_actor_id and is_active=true
 ), params as (
  select (now() at time zone 'Asia/Kolkata')::date business_date,
         greatest(1,least(coalesce(p_page,1),10000)) page_number,
         greatest(1,least(coalesce(p_page_size,50),50)) page_size
 ), authorized as (
  select d.distributor_id,d.distributor_name,d.assigned_to,u.name assigned_employee_name,
         d.renewal_date,public.distributor_renewal_state_v1(d.renewal_date,p.business_date) renewal_state,
         d.version,d.updated_at,p.business_date,p.page_number,p.page_size
  from public.distributor_accounts d
  join public.users u on u.user_id=d.assigned_to
  cross join actor a
  cross join params p
  where (p_admin and a.is_admin) or (not p_admin and d.assigned_to=p_actor_id)
 ), filtered as (
  select distributor_id,distributor_name,assigned_to,assigned_employee_name,renewal_date,renewal_state,version,updated_at,business_date,page_number,page_size from authorized
  where case coalesce(p_filter,'all')
   when 'overdue' then renewal_date<business_date
   when 'today' then renewal_date=business_date
   when 'tomorrow' then renewal_date=business_date+1
   when 'in_two_days' then renewal_date=business_date+2
   when 'upcoming' then renewal_date>business_date+2
   when 'not_set' then renewal_date is null
   when 'all' then true
   else false
  end
 ), page_rows as (
  select distributor_id,distributor_name,assigned_to,assigned_employee_name,renewal_date,renewal_state,version,updated_at from filtered
  order by renewal_date asc nulls last,distributor_name,distributor_id
  offset ((select page_number-1 from params)*(select page_size from params))
  limit (select page_size from params)
 )
 select jsonb_build_object(
  'total',(select count(*) from filtered),
  'page',(select page_number from params),
  'page_size',(select page_size from params),
  'rows',coalesce((select jsonb_agg(jsonb_build_object(
   'distributor_id',distributor_id,'distributor_name',distributor_name,
   'assigned_to',assigned_to,'assigned_employee_name',assigned_employee_name,
   'renewal_date',renewal_date,'renewal_state',renewal_state,
   'version',version,'updated_at',updated_at
  ) order by renewal_date asc nulls last,distributor_name,distributor_id) from page_rows),'[]'::jsonb)
 )
$$;

revoke all on function public.distributor_renewal_metrics_v1(uuid,boolean),public.distributor_renewals_list_v1(uuid,boolean,text,integer,integer) from public,anon,authenticated;
grant execute on function public.distributor_renewal_metrics_v1(uuid,boolean),public.distributor_renewals_list_v1(uuid,boolean,text,integer,integer) to service_role;

commit;
