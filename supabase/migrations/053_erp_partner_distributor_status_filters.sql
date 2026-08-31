begin;

create or replace function public.distributor_financial_projection_v2(
  p_actor_id uuid,p_page integer,p_page_size integer,p_search text default null,
  p_assigned_to uuid default null,p_payment_filter text default null,p_billing_filter text default null,
  p_erp_id uuid default null,p_erp_unset boolean default false,p_installation_filter text default null,
  p_training_filter text default null,p_mapping_filter text default null,p_activity_filter text default null,
  p_renewal_filter text default null
)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
with bounds as (
  select greatest(coalesce(p_page,1),1) page,least(greatest(coalesce(p_page_size,50),1),50) page_size,
    (now() at time zone 'Asia/Kolkata')::date business_date
), allowed as (
  select d.*,e.erp_name,e.erp_key from public.distributor_accounts d left join public.erp_systems e on e.erp_id=d.erp_id
  where exists(select 1 from public.users u where u.user_id=p_actor_id and u.is_active=true)
    and (public.receivables_is_admin(p_actor_id) or d.assigned_to=p_actor_id)
    and (p_erp_id is null or d.erp_id=p_erp_id)
    and (not coalesce(p_erp_unset,false) or d.erp_id is null)
), receivable_money as (
  select r.distributor_id,r.receivable_id,r.lifecycle_status,r.bill_amount,
    coalesce(p.confirmed_paid_amount,0)::numeric(14,2) confirmed_paid_amount,
    (r.bill_amount-coalesce(p.confirmed_paid_amount,0))::numeric(14,2) outstanding_amount,
    coalesce(p.pending_payment_count,0)::integer pending_payment_count
  from allowed d join public.receivables r on r.distributor_id=d.distributor_id
  left join lateral(
    select coalesce(sum(rp.amount) filter(where rp.verification_status='confirmed' and rp.reversed_at is null),0)::numeric(14,2) confirmed_paid_amount,
      count(*) filter(where rp.verification_status='reported')::integer pending_payment_count
    from public.receivable_payments rp where rp.receivable_id=r.receivable_id
  )p on true
), financial as (
  select d.distributor_id,
    count(r.receivable_id) filter(where r.lifecycle_status<>'cancelled')::integer active_receivable_count,
    coalesce(sum(r.bill_amount) filter(where r.lifecycle_status<>'cancelled'),0)::numeric(14,2) total_bill_amount,
    coalesce(sum(r.confirmed_paid_amount) filter(where r.lifecycle_status<>'cancelled'),0)::numeric(14,2) confirmed_collected_amount,
    coalesce(sum(r.outstanding_amount) filter(where r.lifecycle_status<>'cancelled'),0)::numeric(14,2) outstanding_amount,
    coalesce(sum(r.pending_payment_count) filter(where r.lifecycle_status<>'cancelled'),0)::integer pending_verification_count,
    coalesce(bool_or(r.lifecycle_status='disputed') filter(where r.lifecycle_status<>'cancelled'),false) has_disputed
  from allowed d left join receivable_money r on r.distributor_id=d.distributor_id group by d.distributor_id
), classified as (
  select d.*,f.active_receivable_count,f.total_bill_amount,f.confirmed_collected_amount,f.outstanding_amount,
    f.pending_verification_count,
    case when f.has_disputed then 'DISPUTED'
      when f.active_receivable_count=0 and d.billing_status='billed' then 'COLLECTION_SETUP_REQUIRED'
      when f.active_receivable_count=0 then 'NOT_BILLED'
      when f.outstanding_amount=0 then 'PAID'
      when f.confirmed_collected_amount>0 then 'PARTIALLY_PAID' else 'UNPAID' end collection_state,
    (d.billing_status='not_billed' and f.active_receivable_count>0) billing_collection_mismatch
  from allowed d join financial f using(distributor_id)
), filtered as (
  select classified.* from classified cross join bounds
  where (p_search is null or btrim(p_search)='' or distributor_name ilike '%'||replace(replace(replace(btrim(p_search),'%',' '),'_',' '),',',' ')||'%' or distributor_reference ilike '%'||replace(replace(replace(btrim(p_search),'%',' '),'_',' '),',',' ')||'%')
    and (p_assigned_to is null or assigned_to=p_assigned_to)
    and (p_billing_filter is null or p_billing_filter='' or billing_status=p_billing_filter)
    and (p_payment_filter is null or p_payment_filter='' or collection_state=p_payment_filter or (p_payment_filter='NOT_PAID' and collection_state in ('UNPAID','PARTIALLY_PAID')))
    and (p_installation_filter is null or installation_status=p_installation_filter)
    and (p_training_filter is null or training_status=p_training_filter)
    and (p_mapping_filter is null or mapping_status=p_mapping_filter)
    and (p_activity_filter is null or activity_status=p_activity_filter)
    and (p_renewal_filter is null or (p_renewal_filter='due_soon' and billing_status='billed' and renewal_date between business_date and business_date+2))
), page_rows as (
  select * from filtered order by updated_at desc,distributor_id desc
  offset(select(page-1)*page_size from bounds) limit(select page_size from bounds)
)
select jsonb_build_object('total',(select count(*) from filtered),'rows',
  coalesce((select jsonb_agg(to_jsonb(page_rows)-'business_date' order by updated_at desc,distributor_id desc) from page_rows),'[]'::jsonb))
$$;

create function public.erp_partner_distributors_v2(
  p_actor_id uuid,p_erp_id uuid default null,p_search text default null,p_page integer default 1,p_page_size integer default 50,
  p_installation_filter text default null,p_training_filter text default null,p_billing_filter text default null,
  p_activity_filter text default null,p_erp_payment_filter text default null,p_renewal_filter text default null
)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
with params as (
  select greatest(1,coalesce(p_page,1)) page,least(50,greatest(1,coalesce(p_page_size,50))) page_size,
    (now() at time zone 'Asia/Kolkata')::date business_date,
    replace(replace(btrim(coalesce(p_search,'')),'%',' '),'_',' ') search
), authorized as materialized (
  select d.distributor_id,d.distributor_name,d.distributor_reference,e.erp_id,e.erp_name,d.city,
    d.installation_status,d.installation_completed_at,d.training_status,d.training_completed_at,d.mapping_status,d.mapped_at,
    d.activity_status,d.billing_status,d.erp_payment_status,d.renewal_date,
    case when d.billing_status='billed' then public.distributor_renewal_state_v1(d.renewal_date,p.business_date) else 'not_actionable' end renewal_state,
    d.updated_at,p.business_date,p.page,p.page_size,p.search
  from public.distributor_accounts d join public.erp_systems e on e.erp_id=d.erp_id
  join public.erp_partner_scopes s on s.erp_id=d.erp_id and s.user_id=p_actor_id cross join params p
  where exists(
    select 1 from public.users u join public.user_capabilities c on c.user_id=u.user_id and c.capability_code='erp_partner_viewer'
    where u.user_id=p_actor_id and u.is_active=true
  ) and (p_erp_id is null or d.erp_id=p_erp_id)
), metrics as (
  select jsonb_build_object(
    'total',count(*),
    'installation_pending',count(*) filter(where installation_status='pending'),
    'training_pending',count(*) filter(where installation_status='done' and training_status='pending'),
    'not_billed',count(*) filter(where billing_status='not_billed'),
    'active',count(*) filter(where activity_status='active'),
    'billed',count(*) filter(where billing_status='billed'),
    'paid',count(*) filter(where erp_payment_status='paid'),
    'renewal_due_soon',count(*) filter(where billing_status='billed' and renewal_date between business_date and business_date+2),
    'renewal_overdue',count(*) filter(where billing_status='billed' and renewal_date<business_date)
  ) value from authorized
), filtered as (
  select * from authorized where
    (search='' or distributor_name ilike '%'||search||'%' or distributor_reference ilike '%'||search||'%')
    and (nullif(p_installation_filter,'') is null or installation_status=p_installation_filter)
    and (nullif(p_training_filter,'') is null or training_status=p_training_filter)
    and (nullif(p_billing_filter,'') is null or billing_status=p_billing_filter)
    and (nullif(p_activity_filter,'') is null or activity_status=p_activity_filter)
    and (nullif(p_erp_payment_filter,'') is null or erp_payment_status=p_erp_payment_filter)
    and (nullif(p_renewal_filter,'') is null
      or (p_renewal_filter='due_soon' and billing_status='billed' and renewal_date between business_date and business_date+2)
      or (p_renewal_filter='overdue' and billing_status='billed' and renewal_date<business_date))
), page_rows as (
  select distributor_id,distributor_name,distributor_reference,erp_id,erp_name,city,
    installation_status,installation_completed_at,training_status,training_completed_at,mapping_status,mapped_at,
    activity_status,billing_status,erp_payment_status,renewal_date,renewal_state,updated_at
  from filtered order by updated_at desc,distributor_id desc
  offset(select(page-1)*page_size from params) limit(select page_size from params)
)
select jsonb_build_object(
  'metrics',(select value from metrics),
  'total',(select count(*) from filtered),
  'rows',coalesce((select jsonb_agg(to_jsonb(page_rows) order by updated_at desc,distributor_id desc) from page_rows),'[]'::jsonb),
  'scopes',coalesce((select jsonb_agg(jsonb_build_object('erp_id',e.erp_id,'erp_name',e.erp_name) order by e.erp_name)
    from public.erp_partner_scopes s join public.erp_systems e using(erp_id)
    where s.user_id=p_actor_id and exists(
      select 1 from public.users u join public.user_capabilities c on c.user_id=u.user_id and c.capability_code='erp_partner_viewer'
      where u.user_id=p_actor_id and u.is_active=true
    )),'[]'::jsonb)
)
$$;

create or replace function public.erp_partner_distributors_v1(
  p_actor_id uuid,p_erp_id uuid default null,p_search text default null,p_page integer default 1,p_page_size integer default 50
)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  select public.erp_partner_distributors_v2(p_actor_id,p_erp_id,p_search,p_page,p_page_size,null,null,null,null,null,null)
$$;

revoke all on function public.erp_partner_distributors_v2(uuid,uuid,text,integer,integer,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.erp_partner_distributors_v2(uuid,uuid,text,integer,integer,text,text,text,text,text,text) to service_role;

commit;
