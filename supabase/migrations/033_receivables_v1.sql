-- REVIEW-ONLY R3 MIGRATION. OWNER APPROVAL REQUIRED.
-- Apply exactly once through the Supabase migration mechanism. Do not rerun manually.
-- Additive financial authority. No existing CRM business record is read or rewritten.

create table public.receivable_import_batches (
  batch_id uuid primary key,
  uploaded_by uuid not null references public.users(user_id) on delete restrict,
  filename text not null check (char_length(filename) between 1 and 255),
  payload_hash text not null check (char_length(payload_hash) = 64),
  row_count integer not null check (row_count between 0 and 5000),
  created_count integer not null check (created_count >= 0),
  duplicate_count integer not null check (duplicate_count >= 0),
  invalid_count integer not null check (invalid_count >= 0),
  created_at timestamptz not null default now()
);
create unique index receivable_import_batches_actor_hash_uidx on public.receivable_import_batches(uploaded_by,payload_hash);

create table public.receivables (
  receivable_id uuid primary key,
  bill_reference text not null check (char_length(btrim(bill_reference)) between 1 and 120),
  bill_reference_key text not null check (char_length(btrim(bill_reference_key)) between 1 and 120),
  distributor_name text not null check (char_length(btrim(distributor_name)) between 1 and 200),
  distributor_identity_key text not null check (char_length(btrim(distributor_identity_key)) between 1 and 240),
  distributor_code text check (distributor_code is null or char_length(btrim(distributor_code)) between 1 and 80),
  contact_person text not null check (char_length(btrim(contact_person)) between 1 and 160),
  contact_phone text check (contact_phone is null or char_length(btrim(contact_phone)) between 1 and 40),
  bill_amount numeric(14,2) not null check (bill_amount > 0),
  bill_due_date date not null,
  next_follow_up_date date,
  assigned_to uuid not null references public.users(user_id) on delete restrict,
  lifecycle_status text not null default 'active' check (lifecycle_status in ('active','disputed','cancelled')),
  source text not null check (source in ('manual','import')),
  source_batch_id uuid references public.receivable_import_batches(batch_id) on delete restrict,
  source_row_number integer check (source_row_number is null or source_row_number > 1),
  created_by uuid not null references public.users(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version > 0),
  cancelled_at timestamptz,
  cancelled_by uuid references public.users(user_id) on delete restrict,
  cancellation_reason text check (cancellation_reason is null or char_length(btrim(cancellation_reason)) between 1 and 500),
  constraint receivable_cancel_fields check (
    (lifecycle_status <> 'cancelled' and cancelled_at is null and cancelled_by is null and cancellation_reason is null)
    or
    (lifecycle_status = 'cancelled' and cancelled_at is not null and cancelled_by is not null
      and cancellation_reason is not null and btrim(cancellation_reason) <> '')
  ),
  constraint receivable_business_identity_unique unique(distributor_identity_key,bill_reference_key)
);

create table public.receivable_payments (
  payment_id uuid primary key,
  receivable_id uuid not null references public.receivables(receivable_id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  payment_date date not null,
  payment_mode text check (payment_mode is null or char_length(btrim(payment_mode)) between 1 and 60),
  payment_reference text check (payment_reference is null or char_length(btrim(payment_reference)) between 1 and 160),
  note text check (note is null or char_length(note) <= 1000),
  reported_by uuid not null references public.users(user_id) on delete restrict,
  reported_at timestamptz not null default now(),
  verification_status text not null check (verification_status in ('reported','confirmed','rejected','reversed')),
  verified_by uuid references public.users(user_id) on delete restrict,
  verified_at timestamptz,
  rejection_reason text check (rejection_reason is null or char_length(btrim(rejection_reason)) between 1 and 500),
  reversed_by uuid references public.users(user_id) on delete restrict,
  reversed_at timestamptz,
  reversal_reason text check (reversal_reason is null or char_length(btrim(reversal_reason)) between 1 and 500),
  constraint receivable_payment_verification_fields check (
    (verification_status='reported' and verified_by is null and verified_at is null and rejection_reason is null and reversed_by is null and reversed_at is null and reversal_reason is null)
    or
    (verification_status='confirmed' and verified_by is not null and verified_at is not null and rejection_reason is null and reversed_by is null and reversed_at is null and reversal_reason is null)
    or
    (verification_status='rejected' and verified_by is not null and verified_at is not null
      and rejection_reason is not null and btrim(rejection_reason) <> '' and reversed_by is null and reversed_at is null and reversal_reason is null)
    or
    (verification_status='reversed' and verified_by is not null and verified_at is not null
      and reversed_by is not null and reversed_at is not null and reversal_reason is not null and btrim(reversal_reason) <> '')
  )
);

create table public.receivable_activity_events (
  activity_id uuid primary key,
  receivable_id uuid not null references public.receivables(receivable_id) on delete restrict,
  actor_id uuid not null references public.users(user_id) on delete restrict,
  event_type text not null check (event_type in ('created','assigned','followup_contacted','followup_no_response','promise_to_pay','payment_reported','payment_confirmed','payment_rejected','payment_reversed','admin_updated','disputed','dispute_resolved','cancelled')),
  next_follow_up_date date,
  promise_date date,
  promise_amount numeric(14,2) check (promise_amount is null or promise_amount > 0),
  payment_id uuid references public.receivable_payments(payment_id) on delete restrict,
  note text check (note is null or char_length(note) <= 1000),
  change_set jsonb check (change_set is null or jsonb_typeof(change_set) = 'object'),
  created_at timestamptz not null default now(),
  constraint receivable_event_semantics check (
    (event_type not in ('followup_contacted','followup_no_response') or next_follow_up_date is not null)
    and (event_type <> 'promise_to_pay' or promise_date is not null)
    and (event_type not in ('payment_reported','payment_confirmed','payment_rejected','payment_reversed') or payment_id is not null)
  )
);

create table public.receivable_operation_receipts (
  operation_id uuid primary key,
  operation_type text not null check (char_length(operation_type) between 1 and 60),
  actor_id uuid not null references public.users(user_id) on delete restrict,
  receivable_id uuid references public.receivables(receivable_id) on delete restrict,
  request_hash text not null check (char_length(request_hash) = 64),
  result jsonb not null,
  created_at timestamptz not null default now()
);

create index receivables_owner_followup_idx on public.receivables(assigned_to,next_follow_up_date) where lifecycle_status='active';
create index receivables_due_idx on public.receivables(bill_due_date);
create index receivables_status_created_idx on public.receivables(lifecycle_status,created_at desc);
create index receivable_payments_parent_status_idx on public.receivable_payments(receivable_id,verification_status);
create index receivable_payments_pending_idx on public.receivable_payments(reported_at) where verification_status='reported';
create index receivable_activity_parent_created_idx on public.receivable_activity_events(receivable_id,created_at desc);

alter table public.receivables enable row level security;
alter table public.receivable_payments enable row level security;
alter table public.receivable_activity_events enable row level security;
alter table public.receivable_import_batches enable row level security;
alter table public.receivable_operation_receipts enable row level security;

revoke all on public.receivables,public.receivable_payments,public.receivable_activity_events,public.receivable_import_batches,public.receivable_operation_receipts from public,anon,authenticated;
grant select on public.receivables,public.receivable_payments,public.receivable_activity_events to authenticated;
grant all on public.receivables,public.receivable_payments,public.receivable_activity_events,public.receivable_import_batches,public.receivable_operation_receipts to service_role;

create or replace function public.receivables_is_admin(p_user_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.users u where u.user_id=p_user_id and u.is_active=true)
    and exists(select 1 from public.user_capabilities c where c.user_id=p_user_id and c.capability_code='admin')
$$;
revoke all on function public.receivables_is_admin(uuid) from public,anon;
grant execute on function public.receivables_is_admin(uuid) to authenticated,service_role;

create policy receivables_select_authorized on public.receivables for select to authenticated
using (assigned_to=auth.uid() or public.receivables_is_admin(auth.uid()));
create policy receivable_payments_select_authorized on public.receivable_payments for select to authenticated
using (exists(select 1 from public.receivables r where r.receivable_id=receivable_payments.receivable_id and (r.assigned_to=auth.uid() or public.receivables_is_admin(auth.uid()))));
create policy receivable_activity_select_authorized on public.receivable_activity_events for select to authenticated
using (exists(select 1 from public.receivables r where r.receivable_id=receivable_activity_events.receivable_id and (r.assigned_to=auth.uid() or public.receivables_is_admin(auth.uid()))));

create or replace view public.receivables_financial_read_v1 with (security_invoker=true) as
with money as (
  select receivable_id,
    coalesce(sum(amount) filter(where verification_status='confirmed'),0)::numeric(14,2) confirmed_paid_amount,
    count(*) filter(where verification_status='reported') pending_payment_count
  from public.receivable_payments group by receivable_id
), latest_action as (
  select receivable_id,case when event_type='promise_to_pay' then promise_date end promise_date
  from (
    select distinct on(receivable_id) receivable_id,event_type,promise_date
    from public.receivable_activity_events
    where event_type in ('followup_contacted','followup_no_response','promise_to_pay','payment_reported','payment_confirmed','payment_rejected','payment_reversed')
    order by receivable_id,created_at desc,activity_id desc
  ) latest
)
select r.*,
  coalesce(m.confirmed_paid_amount,0)::numeric(14,2) confirmed_paid_amount,
  (r.bill_amount-coalesce(m.confirmed_paid_amount,0))::numeric(14,2) outstanding_amount,
  coalesce(m.pending_payment_count,0) pending_payment_count,
  a.promise_date,
  case when r.lifecycle_status='cancelled' then 'Cancelled'
    when r.lifecycle_status='disputed' then 'Disputed'
    when coalesce(m.confirmed_paid_amount,0)=0 then 'Unpaid'
    when coalesce(m.confirmed_paid_amount,0)<r.bill_amount then 'Partially Paid' else 'Paid' end payment_state,
  case when r.lifecycle_status='cancelled' or r.bill_amount-coalesce(m.confirmed_paid_amount,0)=0 then 'none'
    when r.lifecycle_status='disputed' then 'disputed'
    when coalesce(m.pending_payment_count,0)>0 then 'payment_verification_pending'
    when a.promise_date < (now() at time zone 'Asia/Kolkata')::date then 'promise_overdue'
    when r.next_follow_up_date < (now() at time zone 'Asia/Kolkata')::date then 'followup_overdue'
    when a.promise_date=(now() at time zone 'Asia/Kolkata')::date then 'promise_due_today'
    when r.next_follow_up_date=(now() at time zone 'Asia/Kolkata')::date then 'followup_due_today'
    when coalesce(a.promise_date,r.next_follow_up_date) is not null then 'upcoming' else 'none' end alert_state,
  case when r.lifecycle_status='cancelled' or r.bill_amount-coalesce(m.confirmed_paid_amount,0)=0 then 8
    when r.lifecycle_status='disputed' then 7
    when coalesce(m.pending_payment_count,0)>0 then 6
    when a.promise_date < (now() at time zone 'Asia/Kolkata')::date then 1
    when r.next_follow_up_date < (now() at time zone 'Asia/Kolkata')::date then 2
    when a.promise_date=(now() at time zone 'Asia/Kolkata')::date then 3
    when r.next_follow_up_date=(now() at time zone 'Asia/Kolkata')::date then 4
    when coalesce(a.promise_date,r.next_follow_up_date) is not null then 5 else 8 end collection_priority,
  coalesce(a.promise_date,r.next_follow_up_date,r.bill_due_date) collection_sort_date,
  greatest(0,(now() at time zone 'Asia/Kolkata')::date-r.bill_due_date) aging_days,
  case when r.bill_due_date >= (now() at time zone 'Asia/Kolkata')::date then 'Current'
    when (now() at time zone 'Asia/Kolkata')::date-r.bill_due_date<=7 then '1-7 days'
    when (now() at time zone 'Asia/Kolkata')::date-r.bill_due_date<=15 then '8-15 days'
    when (now() at time zone 'Asia/Kolkata')::date-r.bill_due_date<=30 then '16-30 days' else '31+ days' end aging_bucket
from public.receivables r left join money m using(receivable_id) left join latest_action a using(receivable_id);
revoke all on public.receivables_financial_read_v1 from public,anon;
grant select on public.receivables_financial_read_v1 to authenticated,service_role;

create or replace function public.execute_receivable_command_v1(
  p_operation_id uuid,p_operation_type text,p_actor_id uuid,p_request_hash text,p_payload jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_receipt public.receivable_operation_receipts%rowtype;
  v_r public.receivables%rowtype;
  v_payment public.receivable_payments%rowtype;
  v_admin boolean;
  v_paid numeric(14,2);
  v_pending integer;
  v_result jsonb;
  v_event text;
  v_change_set jsonb;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_next_date date;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_receipt from public.receivable_operation_receipts where operation_id=p_operation_id;
  if found then
    if v_receipt.actor_id<>p_actor_id or v_receipt.operation_type<>p_operation_type or v_receipt.request_hash<>p_request_hash then
      return jsonb_build_object('success',false,'code','RECEIVABLE_OPERATION_MISMATCH');
    end if;
    return v_receipt.result;
  end if;
  if not exists(select 1 from public.users where user_id=p_actor_id and is_active=true) then
    return jsonb_build_object('success',false,'code','ACCOUNT_INACTIVE');
  end if;
  v_admin:=public.receivables_is_admin(p_actor_id);

  if p_operation_type='create' then
    if not v_admin then return jsonb_build_object('success',false,'code','ADMIN_REQUIRED'); end if;
    if not exists(select 1 from public.users where user_id=(p_payload->>'assigned_to')::uuid) then
      return jsonb_build_object('success',false,'code','INVALID_ASSIGNEE');
    end if;
    if not exists(select 1 from public.users where user_id=(p_payload->>'assigned_to')::uuid and is_active=true) then
      return jsonb_build_object('success',false,'code','ASSIGNEE_INACTIVE');
    end if;
    if nullif(p_payload->>'next_follow_up_date','') is null or (p_payload->>'next_follow_up_date')::date < v_today then
      return jsonb_build_object('success',false,'code','INVALID_FOLLOW_UP_DATE');
    end if;
    begin
      insert into public.receivables(receivable_id,bill_reference,bill_reference_key,distributor_name,distributor_identity_key,distributor_code,contact_person,contact_phone,bill_amount,bill_due_date,next_follow_up_date,assigned_to,source,created_by)
      values((p_payload->>'receivable_id')::uuid,p_payload->>'bill_reference',lower(regexp_replace(btrim(p_payload->>'bill_reference'),'\s+',' ','g')),p_payload->>'distributor_name',case when nullif(btrim(p_payload->>'distributor_code'),'') is not null then 'code:'||lower(btrim(p_payload->>'distributor_code')) else 'name:'||lower(regexp_replace(btrim(p_payload->>'distributor_name'),'\s+',' ','g')) end,nullif(btrim(p_payload->>'distributor_code'),''),p_payload->>'contact_person',nullif(btrim(p_payload->>'contact_phone'),''),(p_payload->>'bill_amount')::numeric,(p_payload->>'bill_due_date')::date,(p_payload->>'next_follow_up_date')::date,(p_payload->>'assigned_to')::uuid,'manual',p_actor_id)
      returning * into v_r;
    exception when unique_violation then
      return jsonb_build_object('success',false,'code','RECEIVABLE_DUPLICATE');
    end;
    v_event:='created';
    v_change_set:=jsonb_build_object('source','manual');
  else
    select * into v_r from public.receivables where receivable_id=(p_payload->>'receivable_id')::uuid for update;
    if not found then return jsonb_build_object('success',false,'code','RECEIVABLE_NOT_FOUND'); end if;
    if v_r.version<>(p_payload->>'expected_version')::bigint then
      return jsonb_build_object('success',false,'code','RECEIVABLE_CONFLICT','current',to_jsonb(v_r));
    end if;
    if p_operation_type in ('contacted','no_response','promise','payment_report') and (v_admin or v_r.assigned_to<>p_actor_id) then
      return jsonb_build_object('success',false,'code','RECEIVABLE_NOT_ASSIGNED');
    end if;
    if p_operation_type in ('contacted','no_response','promise','payment_report') and v_r.lifecycle_status<>'active' then
      return jsonb_build_object('success',false,'code','RECEIVABLE_NOT_ACTIVE');
    end if;
    select coalesce(sum(amount) filter(where verification_status='confirmed'),0),count(*) filter(where verification_status='reported') into v_paid,v_pending
    from public.receivable_payments where receivable_id=v_r.receivable_id;
    if p_operation_type in ('contacted','no_response','promise','payment_report') and v_r.bill_amount-v_paid<=0 then
      return jsonb_build_object('success',false,'code','RECEIVABLE_ALREADY_PAID');
    end if;
    if p_operation_type in ('contacted','no_response','promise','payment_report') and v_pending>0 then
      return jsonb_build_object('success',false,'code','PAYMENT_VERIFICATION_PENDING');
    end if;

    if p_operation_type in ('contacted','no_response') then
      if nullif(p_payload->>'next_follow_up_date','') is null or (p_payload->>'next_follow_up_date')::date < v_today then
        return jsonb_build_object('success',false,'code','NEXT_FOLLOW_UP_REQUIRED');
      end if;
      v_change_set:=jsonb_build_object('next_follow_up_date',jsonb_build_object('old',v_r.next_follow_up_date,'new',(p_payload->>'next_follow_up_date')::date));
      update public.receivables set next_follow_up_date=(p_payload->>'next_follow_up_date')::date,updated_at=now(),version=version+1 where receivable_id=v_r.receivable_id returning * into v_r;
      v_event:=case when p_operation_type='contacted' then 'followup_contacted' else 'followup_no_response' end;
    elsif p_operation_type='promise' then
      if nullif(p_payload->>'promise_date','') is null or (p_payload->>'promise_date')::date < v_today
        or (nullif(p_payload->>'promise_amount','') is not null and ((p_payload->>'promise_amount')::numeric<=0 or (p_payload->>'promise_amount')::numeric>v_r.bill_amount-v_paid)) then
        return jsonb_build_object('success',false,'code','INVALID_PROMISE');
      end if;
      v_change_set:=jsonb_build_object('next_follow_up_date',jsonb_build_object('old',v_r.next_follow_up_date,'new',(p_payload->>'promise_date')::date));
      update public.receivables set next_follow_up_date=(p_payload->>'promise_date')::date,updated_at=now(),version=version+1 where receivable_id=v_r.receivable_id returning * into v_r;
      v_event:='promise_to_pay';
    elsif p_operation_type='payment_report' then
      if (p_payload->>'payment_date')::date > v_today then return jsonb_build_object('success',false,'code','FUTURE_PAYMENT_DATE'); end if;
      if (p_payload->>'amount')::numeric<=0 or (p_payload->>'amount')::numeric>v_r.bill_amount-v_paid then return jsonb_build_object('success',false,'code','PAYMENT_NOT_ELIGIBLE'); end if;
      begin
        insert into public.receivable_payments(payment_id,receivable_id,amount,payment_date,payment_mode,payment_reference,note,reported_by,verification_status)
        values((p_payload->>'payment_id')::uuid,v_r.receivable_id,(p_payload->>'amount')::numeric,(p_payload->>'payment_date')::date,nullif(btrim(p_payload->>'payment_mode'),''),nullif(btrim(p_payload->>'payment_reference'),''),nullif(p_payload->>'note',''),p_actor_id,'reported') returning * into v_payment;
      exception when unique_violation then
        return jsonb_build_object('success',false,'code','PAYMENT_DUPLICATE');
      end;
      update public.receivables set updated_at=now(),version=version+1 where receivable_id=v_r.receivable_id returning * into v_r;
      v_event:='payment_reported';
    elsif p_operation_type in ('confirm_payment','reject_payment','reverse_payment','direct_payment','reassign','update','dispute','resolve_dispute','cancel') then
      if not v_admin then return jsonb_build_object('success',false,'code','ADMIN_REQUIRED'); end if;
      if p_operation_type in ('confirm_payment','reject_payment','reverse_payment') then
        select * into v_payment from public.receivable_payments where payment_id=(p_payload->>'payment_id')::uuid and receivable_id=v_r.receivable_id for update;
        if not found then return jsonb_build_object('success',false,'code','PAYMENT_NOT_FOUND'); end if;
      end if;
      if p_operation_type='confirm_payment' then
        if v_payment.verification_status<>'reported' or v_r.lifecycle_status='cancelled' or v_payment.amount>v_r.bill_amount-v_paid then
          return jsonb_build_object('success',false,'code','PAYMENT_NOT_ELIGIBLE');
        end if;
        v_next_date:=coalesce((p_payload->>'next_follow_up_date')::date,v_r.next_follow_up_date);
        if v_payment.amount<v_r.bill_amount-v_paid and (v_next_date is null or v_next_date<v_today) then
          return jsonb_build_object('success',false,'code','NEXT_FOLLOW_UP_REQUIRED');
        end if;
        update public.receivable_payments set verification_status='confirmed',verified_by=p_actor_id,verified_at=now() where payment_id=v_payment.payment_id;
        update public.receivables set next_follow_up_date=case when v_payment.amount=v_r.bill_amount-v_paid then null else v_next_date end,updated_at=now(),version=version+1 where receivable_id=v_r.receivable_id returning * into v_r;
        v_event:='payment_confirmed';
      elsif p_operation_type='reject_payment' then
        if v_payment.verification_status<>'reported' or nullif(btrim(p_payload->>'reason'),'') is null then return jsonb_build_object('success',false,'code','PAYMENT_NOT_ELIGIBLE'); end if;
        update public.receivable_payments set verification_status='rejected',verified_by=p_actor_id,verified_at=now(),rejection_reason=btrim(p_payload->>'reason') where payment_id=v_payment.payment_id;
        update public.receivables set updated_at=now(),version=version+1 where receivable_id=v_r.receivable_id returning * into v_r;
        v_event:='payment_rejected';
      elsif p_operation_type='reverse_payment' then
        if v_payment.verification_status<>'confirmed' or nullif(btrim(p_payload->>'reason'),'') is null then return jsonb_build_object('success',false,'code','PAYMENT_NOT_ELIGIBLE'); end if;
        update public.receivable_payments set verification_status='reversed',reversed_by=p_actor_id,reversed_at=now(),reversal_reason=btrim(p_payload->>'reason') where payment_id=v_payment.payment_id;
        update public.receivables set next_follow_up_date=coalesce((p_payload->>'next_follow_up_date')::date,v_today),updated_at=now(),version=version+1 where receivable_id=v_r.receivable_id returning * into v_r;
        v_event:='payment_reversed';
      elsif p_operation_type='direct_payment' then
        if v_r.lifecycle_status='cancelled' or (p_payload->>'amount')::numeric<=0 or (p_payload->>'amount')::numeric>v_r.bill_amount-v_paid then return jsonb_build_object('success',false,'code','PAYMENT_NOT_ELIGIBLE'); end if;
        if (p_payload->>'payment_date')::date > v_today then return jsonb_build_object('success',false,'code','FUTURE_PAYMENT_DATE'); end if;
        v_next_date:=coalesce((p_payload->>'next_follow_up_date')::date,v_r.next_follow_up_date);
        if (p_payload->>'amount')::numeric<v_r.bill_amount-v_paid and (v_next_date is null or v_next_date<v_today) then return jsonb_build_object('success',false,'code','NEXT_FOLLOW_UP_REQUIRED'); end if;
        begin
          insert into public.receivable_payments(payment_id,receivable_id,amount,payment_date,payment_mode,payment_reference,note,reported_by,verification_status,verified_by,verified_at)
          values((p_payload->>'payment_id')::uuid,v_r.receivable_id,(p_payload->>'amount')::numeric,(p_payload->>'payment_date')::date,nullif(btrim(p_payload->>'payment_mode'),''),nullif(btrim(p_payload->>'payment_reference'),''),nullif(p_payload->>'note',''),p_actor_id,'confirmed',p_actor_id,now()) returning * into v_payment;
        exception when unique_violation then
          return jsonb_build_object('success',false,'code','PAYMENT_DUPLICATE');
        end;
        update public.receivables set next_follow_up_date=case when (p_payload->>'amount')::numeric=v_r.bill_amount-v_paid then null else v_next_date end,updated_at=now(),version=version+1 where receivable_id=v_r.receivable_id returning * into v_r;
        v_event:='payment_confirmed';
      elsif p_operation_type='reassign' then
        if not exists(select 1 from public.users where user_id=(p_payload->>'assigned_to')::uuid) then return jsonb_build_object('success',false,'code','INVALID_ASSIGNEE'); end if;
        if not exists(select 1 from public.users where user_id=(p_payload->>'assigned_to')::uuid and is_active=true) then return jsonb_build_object('success',false,'code','ASSIGNEE_INACTIVE'); end if;
        v_change_set:=jsonb_build_object('assigned_to',jsonb_build_object('old',v_r.assigned_to,'new',(p_payload->>'assigned_to')::uuid));
        update public.receivables set assigned_to=(p_payload->>'assigned_to')::uuid,updated_at=now(),version=version+1 where receivable_id=v_r.receivable_id returning * into v_r;
        v_event:='assigned';
      elsif p_operation_type='update' then
        if (p_payload ? 'bill_amount') and (p_payload->>'bill_amount')::numeric<v_paid then return jsonb_build_object('success',false,'code','BILL_BELOW_CONFIRMED'); end if;
        v_next_date:=coalesce((p_payload->>'next_follow_up_date')::date,v_r.next_follow_up_date);
        if v_r.lifecycle_status='active' and coalesce((p_payload->>'bill_amount')::numeric,v_r.bill_amount)>v_paid
          and (v_next_date is null or v_next_date<v_today) then return jsonb_build_object('success',false,'code','NEXT_FOLLOW_UP_REQUIRED'); end if;
        v_change_set:=jsonb_strip_nulls(jsonb_build_object(
          'bill_amount',case when p_payload ? 'bill_amount' and (p_payload->>'bill_amount')::numeric is distinct from v_r.bill_amount then jsonb_build_object('old',v_r.bill_amount,'new',(p_payload->>'bill_amount')::numeric) end,
          'contact_person',case when p_payload ? 'contact_person' and p_payload->>'contact_person' is distinct from v_r.contact_person then jsonb_build_object('old',v_r.contact_person,'new',p_payload->>'contact_person') end,
          'contact_phone',case when p_payload ? 'contact_phone' and nullif(p_payload->>'contact_phone','') is distinct from v_r.contact_phone then jsonb_build_object('old',v_r.contact_phone,'new',nullif(p_payload->>'contact_phone','')) end,
          'bill_due_date',case when p_payload ? 'bill_due_date' and (p_payload->>'bill_due_date')::date is distinct from v_r.bill_due_date then jsonb_build_object('old',v_r.bill_due_date,'new',(p_payload->>'bill_due_date')::date) end,
          'next_follow_up_date',case when p_payload ? 'next_follow_up_date' and (p_payload->>'next_follow_up_date')::date is distinct from v_r.next_follow_up_date then jsonb_build_object('old',v_r.next_follow_up_date,'new',(p_payload->>'next_follow_up_date')::date) end));
        update public.receivables set bill_amount=coalesce((p_payload->>'bill_amount')::numeric,bill_amount),contact_person=coalesce(nullif(p_payload->>'contact_person',''),contact_person),contact_phone=case when p_payload ? 'contact_phone' then nullif(p_payload->>'contact_phone','') else contact_phone end,bill_due_date=coalesce((p_payload->>'bill_due_date')::date,bill_due_date),next_follow_up_date=v_next_date,updated_at=now(),version=version+1 where receivable_id=v_r.receivable_id returning * into v_r;
        v_event:='admin_updated';
      elsif p_operation_type='dispute' then
        if v_r.lifecycle_status<>'active' then return jsonb_build_object('success',false,'code','INVALID_RECEIVABLE_STATE'); end if;
        v_change_set:=jsonb_build_object('lifecycle_status',jsonb_build_object('old',v_r.lifecycle_status,'new','disputed'));
        update public.receivables set lifecycle_status='disputed',updated_at=now(),version=version+1 where receivable_id=v_r.receivable_id returning * into v_r;
        v_event:='disputed';
      elsif p_operation_type='resolve_dispute' then
        if v_r.lifecycle_status<>'disputed' then return jsonb_build_object('success',false,'code','INVALID_RECEIVABLE_STATE'); end if;
        v_change_set:=jsonb_build_object('lifecycle_status',jsonb_build_object('old',v_r.lifecycle_status,'new','active'));
        update public.receivables set lifecycle_status='active',updated_at=now(),version=version+1 where receivable_id=v_r.receivable_id returning * into v_r;
        v_event:='dispute_resolved';
      elsif p_operation_type='cancel' then
        if v_r.lifecycle_status not in ('active','disputed') then return jsonb_build_object('success',false,'code','INVALID_RECEIVABLE_STATE'); end if;
        if v_pending>0 then return jsonb_build_object('success',false,'code','PAYMENT_VERIFICATION_PENDING'); end if;
        if v_paid>0 or nullif(btrim(p_payload->>'reason'),'') is null then return jsonb_build_object('success',false,'code','CANCELLATION_UNSAFE'); end if;
        v_change_set:=jsonb_build_object('lifecycle_status',jsonb_build_object('old',v_r.lifecycle_status,'new','cancelled'));
        update public.receivables set lifecycle_status='cancelled',cancelled_at=now(),cancelled_by=p_actor_id,cancellation_reason=btrim(p_payload->>'reason'),next_follow_up_date=null,updated_at=now(),version=version+1 where receivable_id=v_r.receivable_id returning * into v_r;
        v_event:='cancelled';
      end if;
    else
      return jsonb_build_object('success',false,'code','UNKNOWN_OPERATION');
    end if;
  end if;

  insert into public.receivable_activity_events(activity_id,receivable_id,actor_id,event_type,next_follow_up_date,promise_date,promise_amount,payment_id,note,change_set)
  values(gen_random_uuid(),v_r.receivable_id,p_actor_id,v_event,case when v_event in ('followup_contacted','followup_no_response') then v_r.next_follow_up_date end,case when v_event='promise_to_pay' then (p_payload->>'promise_date')::date end,case when v_event='promise_to_pay' then nullif(p_payload->>'promise_amount','')::numeric end,v_payment.payment_id,coalesce(nullif(p_payload->>'reason',''),nullif(p_payload->>'note','')),v_change_set);
  v_result:=jsonb_build_object('success',true,'operation_id',p_operation_id,'receivable_id',v_r.receivable_id,'version',v_r.version,'payment_id',v_payment.payment_id);
  insert into public.receivable_operation_receipts(operation_id,operation_type,actor_id,receivable_id,request_hash,result)
  values(p_operation_id,p_operation_type,p_actor_id,v_r.receivable_id,p_request_hash,v_result);
  return v_result;
end $$;
revoke all on function public.execute_receivable_command_v1(uuid,text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.execute_receivable_command_v1(uuid,text,uuid,text,jsonb) to service_role;

create or replace function public.receivables_my_day_v1(p_actor_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  with urgent as (
    select receivable_id,distributor_name,bill_reference,outstanding_amount,alert_state,next_follow_up_date,
      case alert_state when 'promise_overdue' then 1 when 'followup_overdue' then 2 when 'promise_due_today' then 3 else 4 end priority
    from public.receivables_financial_read_v1
    where assigned_to=p_actor_id and alert_state in ('promise_overdue','followup_overdue','promise_due_today','followup_due_today')
  ), ranked as (
    select * from urgent order by priority,next_follow_up_date,receivable_id limit 5
  ), totals as (
    select count(*) urgent_count,coalesce(sum(outstanding_amount),0)::numeric(14,2) outstanding_amount from urgent
  )
  select jsonb_build_object('enabled',true,'urgentCount',totals.urgent_count,'outstandingAmount',totals.outstanding_amount::text,'rows',coalesce((select jsonb_agg(to_jsonb(ranked) order by priority,next_follow_up_date,receivable_id) from ranked),'[]'::jsonb)) from totals
$$;
revoke all on function public.receivables_my_day_v1(uuid) from public,anon,authenticated;
grant execute on function public.receivables_my_day_v1(uuid) to service_role;

create or replace function public.import_receivables_v1(
  p_operation_id uuid,p_actor_id uuid,p_request_hash text,p_filename text,p_payload_hash text,p_rows jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_receipt public.receivable_operation_receipts%rowtype;
  v_previous public.receivable_import_batches%rowtype;
  v_existing public.receivables%rowtype;
  v_row jsonb;
  v_accepted jsonb := '[]'::jsonb;
  v_seen jsonb := '{}'::jsonb;
  v_batch uuid := gen_random_uuid();
  v_created integer := 0;
  v_duplicates integer := 0;
  v_identity text;
  v_bill_key text;
  v_business_key text;
  v_critical text;
  v_result jsonb;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_receipt from public.receivable_operation_receipts where operation_id=p_operation_id;
  if found then
    if v_receipt.actor_id<>p_actor_id or v_receipt.operation_type<>'import' or v_receipt.request_hash<>p_request_hash then
      return jsonb_build_object('success',false,'code','RECEIVABLE_OPERATION_MISMATCH');
    end if;
    return v_receipt.result;
  end if;
  if not public.receivables_is_admin(p_actor_id) then return jsonb_build_object('success',false,'code','ADMIN_REQUIRED'); end if;
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>5000 then return jsonb_build_object('success',false,'code','IMPORT_INVALID'); end if;
  if char_length(p_filename) not between 1 and 255 or p_payload_hash !~ '^[0-9a-f]{64}$' or p_request_hash !~ '^[0-9a-f]{64}$' then return jsonb_build_object('success',false,'code','IMPORT_INVALID'); end if;

  -- Phase A: authoritative validation/classification only. No persistent writes.
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if nullif(v_row->>'next_follow_up_date','') is null or (v_row->>'next_follow_up_date')::date < v_today
      or coalesce(v_row->>'bill_amount','') !~ '^[0-9]{1,12}\.[0-9]{2}$' or (v_row->>'bill_amount')::numeric<=0
      or char_length(btrim(v_row->>'bill_reference')) not between 1 and 120
      or char_length(btrim(v_row->>'distributor_name')) not between 1 and 200
      or char_length(btrim(v_row->>'contact_person')) not between 1 and 160
      or char_length(coalesce(v_row->>'notes',''))>1000 then
      return jsonb_build_object('success',false,'code','IMPORT_INVALID','rowNumber',(v_row->>'row_number')::integer);
    end if;
    if not exists(select 1 from public.users where user_id=(v_row->>'assigned_to')::uuid) then
      return jsonb_build_object('success',false,'code','INVALID_ASSIGNEE','rowNumber',(v_row->>'row_number')::integer);
    end if;
    if not exists(select 1 from public.users where user_id=(v_row->>'assigned_to')::uuid and is_active=true) then
      return jsonb_build_object('success',false,'code','IMPORT_EMPLOYEE_CHANGED','rowNumber',(v_row->>'row_number')::integer);
    end if;
    v_identity:=case when nullif(btrim(v_row->>'distributor_code'),'') is not null then 'code:'||lower(btrim(v_row->>'distributor_code')) else 'name:'||lower(regexp_replace(btrim(v_row->>'distributor_name'),'\s+',' ','g')) end;
    v_bill_key:=lower(regexp_replace(btrim(v_row->>'bill_reference'),'\s+',' ','g'));
    v_business_key:=v_identity||'|'||v_bill_key;
    v_critical:=concat_ws('|',(v_row->>'bill_amount')::numeric(14,2),(v_row->>'bill_due_date')::date,(v_row->>'next_follow_up_date')::date,(v_row->>'assigned_to')::uuid,btrim(v_row->>'contact_person'),coalesce(nullif(btrim(v_row->>'contact_phone'),''),''));
    if v_seen ? v_business_key then
      if v_seen->>v_business_key=v_critical then v_duplicates:=v_duplicates+1; continue; end if;
      return jsonb_build_object('success',false,'code','IMPORT_REFRESH_REQUIRED','rowNumber',(v_row->>'row_number')::integer);
    end if;
    v_seen:=v_seen||jsonb_build_object(v_business_key,v_critical);
    select * into v_existing from public.receivables where distributor_identity_key=v_identity and bill_reference_key=v_bill_key;
    if found then
      if concat_ws('|',v_existing.bill_amount,v_existing.bill_due_date,v_existing.next_follow_up_date,v_existing.assigned_to,btrim(v_existing.contact_person),coalesce(v_existing.contact_phone,''))=v_critical then
        v_duplicates:=v_duplicates+1; continue;
      end if;
      return jsonb_build_object('success',false,'code','IMPORT_REFRESH_REQUIRED','rowNumber',(v_row->>'row_number')::integer);
    end if;
    v_accepted:=v_accepted||jsonb_build_array(v_row||jsonb_build_object('distributor_identity_key',v_identity,'bill_reference_key',v_bill_key));
  end loop;

  select * into v_previous from public.receivable_import_batches where uploaded_by=p_actor_id and payload_hash=p_payload_hash;
  if found then
    v_result:=jsonb_build_object('success',true,'operation_id',p_operation_id,'batch_id',v_previous.batch_id,'created_count',v_previous.created_count,'duplicate_count',v_previous.duplicate_count,'invalid_count',v_previous.invalid_count,'replayed_batch',true);
    insert into public.receivable_operation_receipts(operation_id,operation_type,actor_id,request_hash,result) values(p_operation_id,'import',p_actor_id,p_request_hash,v_result);
    return v_result;
  end if;

  -- Phase B: mutation only after every row passed. Unexpected errors are not caught;
  -- PostgreSQL therefore rolls back the entire function transaction.
  insert into public.receivable_import_batches(batch_id,uploaded_by,filename,payload_hash,row_count,created_count,duplicate_count,invalid_count)
  values(v_batch,p_actor_id,p_filename,p_payload_hash,jsonb_array_length(p_rows),jsonb_array_length(v_accepted),v_duplicates,0);
  for v_row in select value from jsonb_array_elements(v_accepted) loop
    insert into public.receivables(receivable_id,bill_reference,bill_reference_key,distributor_name,distributor_identity_key,distributor_code,contact_person,contact_phone,bill_amount,bill_due_date,next_follow_up_date,assigned_to,source,source_batch_id,source_row_number,created_by)
    values((v_row->>'receivable_id')::uuid,v_row->>'bill_reference',v_row->>'bill_reference_key',v_row->>'distributor_name',v_row->>'distributor_identity_key',nullif(btrim(v_row->>'distributor_code'),''),v_row->>'contact_person',nullif(btrim(v_row->>'contact_phone'),''),(v_row->>'bill_amount')::numeric,(v_row->>'bill_due_date')::date,(v_row->>'next_follow_up_date')::date,(v_row->>'assigned_to')::uuid,'import',v_batch,(v_row->>'row_number')::integer,p_actor_id);
    insert into public.receivable_activity_events(activity_id,receivable_id,actor_id,event_type,note,change_set)
    values(gen_random_uuid(),(v_row->>'receivable_id')::uuid,p_actor_id,'created',nullif(v_row->>'notes',''),jsonb_build_object('source','import','batch_id',v_batch,'row_number',(v_row->>'row_number')::integer));
    v_created:=v_created+1;
  end loop;
  v_result:=jsonb_build_object('success',true,'operation_id',p_operation_id,'batch_id',v_batch,'created_count',v_created,'duplicate_count',v_duplicates,'invalid_count',0);
  insert into public.receivable_operation_receipts(operation_id,operation_type,actor_id,request_hash,result) values(p_operation_id,'import',p_actor_id,p_request_hash,v_result);
  return v_result;
end $$;
revoke all on function public.import_receivables_v1(uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.import_receivables_v1(uuid,uuid,text,text,text,jsonb) to service_role;

create or replace function public.receivables_admin_metrics_v1(p_actor_id uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  with collectible as (select * from public.receivables_financial_read_v1 where lifecycle_status<>'cancelled'),
  month_bounds as (
    select date_trunc('month',(now() at time zone 'Asia/Kolkata'))::date start_date,
      (date_trunc('month',(now() at time zone 'Asia/Kolkata'))+interval '1 month')::date end_date
  )
  select case when not public.receivables_is_admin(p_actor_id) then jsonb_build_object('success',false,'code','ADMIN_REQUIRED') else jsonb_build_object(
    'success',true,
    'total_outstanding',coalesce(sum(outstanding_amount),0)::text,
    'disputed_outstanding',coalesce(sum(outstanding_amount) filter(where lifecycle_status='disputed'),0)::text,
    'followups_due_today',count(*) filter(where alert_state in ('promise_due_today','followup_due_today')),
    'overdue_outstanding',coalesce(sum(outstanding_amount) filter(where alert_state in ('promise_overdue','followup_overdue')),0)::text,
    'awaiting_verification',coalesce(sum(pending_payment_count),0),
    'collected_this_month',coalesce((select sum(p.amount) from public.receivable_payments p,month_bounds b where p.verification_status='confirmed' and p.payment_date>=b.start_date and p.payment_date<b.end_date),0)::text,
    'aging',jsonb_build_object(
      'Current',coalesce(sum(outstanding_amount) filter(where aging_bucket='Current'),0)::text,
      '1-7 days',coalesce(sum(outstanding_amount) filter(where aging_bucket='1-7 days'),0)::text,
      '8-15 days',coalesce(sum(outstanding_amount) filter(where aging_bucket='8-15 days'),0)::text,
      '16-30 days',coalesce(sum(outstanding_amount) filter(where aging_bucket='16-30 days'),0)::text,
      '31+ days',coalesce(sum(outstanding_amount) filter(where aging_bucket='31+ days'),0)::text)) end
  from collectible
$$;
revoke all on function public.receivables_admin_metrics_v1(uuid) from public,anon,authenticated;
grant execute on function public.receivables_admin_metrics_v1(uuid) to service_role;
