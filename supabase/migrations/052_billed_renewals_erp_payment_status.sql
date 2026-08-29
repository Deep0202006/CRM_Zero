begin;

-- ERP settlement is an operational Distributor Status fact. It is nullable so
-- historical rows remain unknown; this migration performs no backfill.
alter table public.distributor_accounts
  add column erp_payment_status text,
  add constraint distributor_erp_payment_status_check
    check (erp_payment_status is null or erp_payment_status in ('paid','not_paid'));

alter table public.distributor_status_events
  drop constraint distributor_status_events_event_type_check,
  add constraint distributor_status_events_event_type_check check (
    event_type in ('created','status_updated','renewal_date_updated','renewed','reassigned','imported','erp_payment_status_updated')
  );

create or replace function public.distributor_is_financially_paid_v1(p_distributor_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  with active as (
    select r.receivable_id,r.lifecycle_status,r.bill_amount
    from public.receivables r
    where r.distributor_id=p_distributor_id and r.lifecycle_status<>'cancelled'
  ), financial as (
    select r.lifecycle_status,
      (r.bill_amount-coalesce(sum(p.amount) filter(where p.verification_status='confirmed' and p.reversed_at is null),0))::numeric(14,2) outstanding_amount
    from active r left join public.receivable_payments p using(receivable_id)
    group by r.receivable_id,r.lifecycle_status,r.bill_amount
  )
  select count(*)>0
    and coalesce(bool_and(lifecycle_status<>'disputed'),false)
    and coalesce(sum(outstanding_amount),0)=0
  from financial
$$;

create or replace function public.distributor_erp_payment_status_command_v1(
  p_operation_id uuid,p_actor_id uuid,p_operation_type text,p_request_hash text,p_payload jsonb
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_receipt public.distributor_operation_receipts%rowtype;
  v_before public.distributor_accounts%rowtype;
  v_row public.distributor_accounts%rowtype;
  v_id uuid;
  v_status text;
  v_response jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_receipt from public.distributor_operation_receipts where operation_id=p_operation_id for update;
  if found then
    if v_receipt.actor_id<>p_actor_id or v_receipt.request_hash<>p_request_hash or v_receipt.operation_type<>p_operation_type then
      return jsonb_build_object('success',false,'code','DISTRIBUTOR_OPERATION_MISMATCH');
    end if;
    return v_receipt.response;
  end if;
  if p_operation_type<>'erp_payment' then return jsonb_build_object('success',false,'code','INVALID_OPERATION'); end if;
  if not exists(
    select 1 from public.users u
    where u.user_id=p_actor_id and u.is_active=true and public.receivables_is_admin(u.user_id)
  ) then return jsonb_build_object('success',false,'code','ADMIN_REQUIRED'); end if;
  v_id=(p_payload->>'distributor_id')::uuid;
  v_status=nullif(p_payload->>'erp_payment_status','');
  if v_status is null or v_status not in ('paid','not_paid') then
    return jsonb_build_object('success',false,'code','ERP_PAYMENT_STATUS_INVALID');
  end if;
  if coalesce(p_payload->>'expected_version','')!~'^[1-9][0-9]*$' then
    return jsonb_build_object('success',false,'code','DISTRIBUTOR_VERSION_INVALID');
  end if;
  select * into v_row from public.distributor_accounts where distributor_id=v_id for update;
  if not found then return jsonb_build_object('success',false,'code','DISTRIBUTOR_NOT_FOUND'); end if;
  if v_row.version<>(p_payload->>'expected_version')::bigint then
    return jsonb_build_object('success',false,'code','DISTRIBUTOR_CONFLICT','current',to_jsonb(v_row));
  end if;
  if not public.distributor_is_financially_paid_v1(v_id) then
    return jsonb_build_object('success',false,'code','ERP_PAYMENT_STATUS_REQUIRES_PAID');
  end if;
  v_before=v_row;
  update public.distributor_accounts
  set erp_payment_status=v_status,version=version+1,updated_at=now()
  where distributor_id=v_id returning * into v_row;
  insert into public.distributor_status_events(
    event_id,distributor_id,event_type,previous_renewal_date,new_renewal_date,change_set,note,actor_id
  ) values(
    gen_random_uuid(),v_id,'erp_payment_status_updated',v_row.renewal_date,v_row.renewal_date,
    jsonb_build_object('erp_payment_status',jsonb_build_object('from',v_before.erp_payment_status,'to',v_row.erp_payment_status)),
    nullif(btrim(p_payload->>'note'),''),p_actor_id
  );
  v_response=jsonb_build_object('success',true,'record',to_jsonb(v_row));
  insert into public.distributor_operation_receipts(operation_id,actor_id,operation_type,request_hash,response)
  values(p_operation_id,p_actor_id,p_operation_type,p_request_hash,v_response);
  return v_response;
end $$;

drop function public.distributor_financial_projection_v2(uuid,integer,integer,text,uuid,text,text,uuid,boolean);
create function public.distributor_financial_projection_v2(
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
    and (p_renewal_filter is null or (p_renewal_filter='due_soon' and renewal_date between business_date and business_date+2))
), page_rows as (
  select * from filtered order by updated_at desc,distributor_id desc
  offset(select(page-1)*page_size from bounds) limit(select page_size from bounds)
)
select jsonb_build_object('total',(select count(*) from filtered),'rows',
  coalesce((select jsonb_agg(to_jsonb(page_rows)-'business_date' order by updated_at desc,distributor_id desc) from page_rows),'[]'::jsonb))
$$;

create or replace function public.distributor_renewal_metrics_v1(p_actor_id uuid,p_admin boolean)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
with actor as materialized(
  select public.receivables_is_admin(p_actor_id)is_admin from public.users where user_id=p_actor_id and is_active=true
), authorized as (
  select d.renewal_date from public.distributor_accounts d cross join actor a
  where ((p_admin and a.is_admin)or(not p_admin and d.assigned_to=p_actor_id)) and d.billing_status='billed'
), today as (select(now()at time zone 'Asia/Kolkata')::date business_date)
select jsonb_build_object(
  'overdue',count(*)filter(where renewal_date<business_date),
  'today',count(*)filter(where renewal_date=business_date),
  'tomorrow',count(*)filter(where renewal_date=business_date+1),
  'in_two_days',count(*)filter(where renewal_date=business_date+2)
) from authorized cross join today
$$;

create or replace function public.distributor_renewals_list_v2(
  p_actor_id uuid,p_admin boolean,p_filter text default 'all',p_page integer default 1,
  p_page_size integer default 50,p_erp_id uuid default null,p_erp_unset boolean default false
)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
with actor as materialized(
  select public.receivables_is_admin(p_actor_id)is_admin from public.users where user_id=p_actor_id and is_active=true
), params as (
  select(now()at time zone 'Asia/Kolkata')::date business_date,
    greatest(1,least(coalesce(p_page,1),10000))page_number,greatest(1,least(coalesce(p_page_size,50),50))page_size
), authorized as (
  select d.distributor_id,d.distributor_name,d.distributor_reference,d.erp_id,e.erp_name,d.assigned_to,
    u.name assigned_employee_name,d.renewal_date,public.distributor_renewal_state_v1(d.renewal_date,p.business_date)renewal_state,
    d.version,d.updated_at,p.business_date,p.page_number,p.page_size
  from public.distributor_accounts d join public.users u on u.user_id=d.assigned_to left join public.erp_systems e on e.erp_id=d.erp_id
  cross join actor a cross join params p
  where ((p_admin and a.is_admin)or(not p_admin and d.assigned_to=p_actor_id)) and d.billing_status='billed'
    and(p_erp_id is null or d.erp_id=p_erp_id)and(not coalesce(p_erp_unset,false)or d.erp_id is null)
), filtered as (
  select * from authorized where case coalesce(p_filter,'all')
    when 'overdue'then renewal_date<business_date when 'today'then renewal_date=business_date
    when 'tomorrow'then renewal_date=business_date+1 when 'in_two_days'then renewal_date=business_date+2
    when 'upcoming'then renewal_date>business_date+2 when 'not_set'then renewal_date is null when 'all'then true else false end
), page_rows as (
  select distributor_id,distributor_name,distributor_reference,erp_id,erp_name,assigned_to,assigned_employee_name,
    renewal_date,renewal_state,version,updated_at from filtered
  order by renewal_date asc nulls last,distributor_name,distributor_id
  offset(select(page_number-1)*page_size from params)limit(select page_size from params)
)
select jsonb_build_object('total',(select count(*)from filtered),'page',(select page_number from params),
  'page_size',(select page_size from params),'rows',coalesce((select jsonb_agg(to_jsonb(page_rows)
  order by renewal_date asc nulls last,distributor_name,distributor_id)from page_rows),'[]'::jsonb))
$$;

create or replace function public.distributor_renewals_due_v2(p_actor_id uuid,p_admin boolean,p_limit integer default 5)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
with due as (
  select d.distributor_id,d.distributor_name,d.distributor_reference,d.erp_id,e.erp_name,d.renewal_date,
    public.distributor_renewal_state_v1(d.renewal_date,(now()at time zone 'Asia/Kolkata')::date)renewal_state
  from public.distributor_accounts d left join public.erp_systems e on e.erp_id=d.erp_id
  where exists(select 1 from public.users u where u.user_id=p_actor_id and u.is_active=true)
    and((p_admin and public.receivables_is_admin(p_actor_id))or(not p_admin and d.assigned_to=p_actor_id))
    and d.billing_status='billed' and d.renewal_date is not null
    and d.renewal_date<=(now()at time zone 'Asia/Kolkata')::date+2
), counted as (select *,count(*)over()total_count from due)
select jsonb_build_object('total',coalesce(max(total_count),0),'rows',coalesce(jsonb_agg(
  to_jsonb(ordered)-'rn'-'total_count' order by renewal_date,distributor_id
)filter(where rn<=greatest(1,least(coalesce(p_limit,5),50))),'[]'::jsonb))
from(select *,row_number()over(order by renewal_date,distributor_id)rn from counted)ordered
$$;

create or replace function public.erp_partner_distributors_v1(
  p_actor_id uuid,p_erp_id uuid default null,p_search text default null,p_page integer default 1,p_page_size integer default 50
)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
with bounds as (
  select greatest(1,coalesce(p_page,1))page,least(50,greatest(1,coalesce(p_page_size,50)))page_size
), scoped as (
  select d.distributor_id,d.distributor_name,d.distributor_reference,e.erp_id,e.erp_name,d.city,
    d.installation_status,d.installation_completed_at,d.training_status,d.training_completed_at,d.mapping_status,d.mapped_at,
    d.activity_status,d.billing_status,d.erp_payment_status,d.renewal_date,
    public.distributor_renewal_state_v1(d.renewal_date,(now()at time zone 'Asia/Kolkata')::date)renewal_state,d.updated_at
  from public.distributor_accounts d join public.erp_systems e on e.erp_id=d.erp_id
  join public.erp_partner_scopes s on s.erp_id=d.erp_id and s.user_id=p_actor_id
  where exists(select 1 from public.users u join public.user_capabilities c on c.user_id=u.user_id and c.capability_code='erp_partner_viewer' where u.user_id=p_actor_id and u.is_active=true)
    and(p_erp_id is null or d.erp_id=p_erp_id)
    and(p_search is null or btrim(p_search)=''or d.distributor_name ilike '%'||replace(btrim(p_search),'%',' ')||'%'or d.distributor_reference ilike '%'||replace(btrim(p_search),'%',' ')||'%')
), page_rows as (
  select * from scoped order by updated_at desc,distributor_id desc
  offset(select(page-1)*page_size from bounds)limit(select page_size from bounds)
)
select jsonb_build_object('total',(select count(*)from scoped),'rows',coalesce((select jsonb_agg(to_jsonb(page_rows)
  order by updated_at desc,distributor_id desc)from page_rows),'[]'::jsonb),'scopes',coalesce((select jsonb_agg(
  jsonb_build_object('erp_id',e.erp_id,'erp_name',e.erp_name)order by e.erp_name
)from public.erp_partner_scopes s join public.erp_systems e using(erp_id)where s.user_id=p_actor_id),'[]'::jsonb))
$$;

create or replace function public.erp_partner_renewals_v1(
  p_actor_id uuid,p_erp_id uuid default null,p_filter text default 'all',p_page integer default 1,p_page_size integer default 50
)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
with today as (select(now()at time zone 'Asia/Kolkata')::date d), bounds as (
  select greatest(1,coalesce(p_page,1))page,least(50,greatest(1,coalesce(p_page_size,50)))page_size
), scoped as (
  select d.distributor_id,d.distributor_name,d.distributor_reference,e.erp_id,e.erp_name,d.renewal_date,
    public.distributor_renewal_state_v1(d.renewal_date,t.d)renewal_state,d.updated_at,t.d business_date
  from public.distributor_accounts d join public.erp_systems e on e.erp_id=d.erp_id
  join public.erp_partner_scopes s on s.erp_id=d.erp_id and s.user_id=p_actor_id cross join today t
  where exists(select 1 from public.users u join public.user_capabilities c on c.user_id=u.user_id and c.capability_code='erp_partner_viewer' where u.user_id=p_actor_id and u.is_active=true)
    and d.billing_status='billed' and(p_erp_id is null or d.erp_id=p_erp_id)
), filtered as (
  select * from scoped where case coalesce(p_filter,'all')when'overdue'then renewal_date<business_date
    when'today'then renewal_date=business_date when'tomorrow'then renewal_date=business_date+1
    when'in_two_days'then renewal_date=business_date+2 when'all'then true else false end
), page_rows as (
  select * from filtered order by renewal_date asc nulls last,distributor_name,distributor_id
  offset(select(page-1)*page_size from bounds)limit(select page_size from bounds)
)
select jsonb_build_object('total',(select count(*)from filtered),'rows',coalesce((select jsonb_agg(
  to_jsonb(page_rows)-'business_date'order by renewal_date asc nulls last,distributor_name,distributor_id
)from page_rows),'[]'::jsonb),'metrics',jsonb_build_object(
  'overdue',(select count(*)from scoped where renewal_date<business_date),
  'today',(select count(*)from scoped where renewal_date=business_date),
  'tomorrow',(select count(*)from scoped where renewal_date=business_date+1),
  'in_two_days',(select count(*)from scoped where renewal_date=business_date+2)
))
$$;

revoke all on function public.distributor_is_financially_paid_v1(uuid),
  public.distributor_erp_payment_status_command_v1(uuid,uuid,text,text,jsonb),
  public.distributor_financial_projection_v2(uuid,integer,integer,text,uuid,text,text,uuid,boolean,text,text,text,text,text),
  public.distributor_renewal_metrics_v1(uuid,boolean),
  public.distributor_renewals_list_v2(uuid,boolean,text,integer,integer,uuid,boolean),
  public.distributor_renewals_due_v2(uuid,boolean,integer),
  public.erp_partner_distributors_v1(uuid,uuid,text,integer,integer),
  public.erp_partner_renewals_v1(uuid,uuid,text,integer,integer)
from public,anon,authenticated;

grant execute on function public.distributor_is_financially_paid_v1(uuid),
  public.distributor_erp_payment_status_command_v1(uuid,uuid,text,text,jsonb),
  public.distributor_financial_projection_v2(uuid,integer,integer,text,uuid,text,text,uuid,boolean,text,text,text,text,text),
  public.distributor_renewal_metrics_v1(uuid,boolean),
  public.distributor_renewals_list_v2(uuid,boolean,text,integer,integer,uuid,boolean),
  public.distributor_renewals_due_v2(uuid,boolean,integer),
  public.erp_partner_distributors_v1(uuid,uuid,text,integer,integer),
  public.erp_partner_renewals_v1(uuid,uuid,text,integer,integer)
to service_role;

commit;
