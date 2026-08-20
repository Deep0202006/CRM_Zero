begin;

-- A03 read-side resolver. It returns only exact canonical bill identities supplied
-- by the server and performs no business mutation or historical backfill.
create or replace function public.resolve_distributor_master_receivables_v1(p_rows jsonb)
returns table(
  receivable_id uuid,
  distributor_id uuid,
  bill_reference text,
  bill_reference_key text,
  contact_person text,
  contact_phone text,
  bill_amount text,
  bill_due_date date,
  next_follow_up_date date,
  assigned_to uuid,
  lifecycle_status text,
  version bigint,
  confirmed_paid_amount text
)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception using errcode='22023',message='MASTER_RECEIVABLE_RESOLUTION_INVALID';
  end if;
  return query
  with input as (
    select distinct
      (value->>'distributor_id')::uuid as distributor_id,
      lower(regexp_replace(btrim(value->>'bill_reference_key'),'\s+',' ','g')) as bill_reference_key
    from jsonb_array_elements(p_rows)
  )
  select r.receivable_id,r.distributor_id,r.bill_reference,r.bill_reference_key,r.contact_person,r.contact_phone,
         r.bill_amount::text,r.bill_due_date,r.next_follow_up_date,r.assigned_to,r.lifecycle_status,r.version,
         coalesce(p.confirmed_paid_amount,0)::text
  from input i
  join public.receivables r on r.distributor_id=i.distributor_id and r.bill_reference_key=i.bill_reference_key
  left join lateral (
    select sum(rp.amount) filter(where rp.verification_status='confirmed') as confirmed_paid_amount
    from public.receivable_payments rp where rp.receivable_id=r.receivable_id
  ) p on true;
end $$;

revoke all on function public.resolve_distributor_master_receivables_v1(jsonb) from public,anon,authenticated;
grant execute on function public.resolve_distributor_master_receivables_v1(jsonb) to service_role;

-- A04 immutable source-ledger identity for historical confirmed payments.
alter table public.receivable_payments
  add column import_key text
  check (import_key is null or char_length(btrim(import_key)) between 1 and 160);

create unique index receivable_payments_import_key_uidx
  on public.receivable_payments(receivable_id,lower(regexp_replace(btrim(import_key),'\s+',' ','g')))
  where import_key is not null;

create or replace function public.resolve_distributor_master_payment_targets_v1(p_rows jsonb)
returns table(
  row_number integer,
  receivable_id uuid,
  distributor_id uuid,
  bill_reference text,
  bill_amount text,
  next_follow_up_date date,
  lifecycle_status text,
  confirmed_paid_amount text,
  payment_id uuid,
  import_key text,
  payment_amount text,
  payment_date date,
  payment_mode text,
  payment_reference text,
  payment_note text,
  verification_status text
)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception using errcode='22023',message='MASTER_PAYMENT_RESOLUTION_INVALID';
  end if;
  return query
  with input as (
    select
      (value->>'row_number')::integer as row_number,
      (value->>'distributor_id')::uuid as distributor_id,
      lower(regexp_replace(btrim(value->>'bill_reference_key'),'\s+',' ','g')) as bill_reference_key,
      lower(regexp_replace(btrim(value->>'import_key'),'\s+',' ','g')) as import_key
    from jsonb_array_elements(p_rows)
  )
  select i.row_number,r.receivable_id,r.distributor_id,r.bill_reference,r.bill_amount::text,r.next_follow_up_date,r.lifecycle_status,
         coalesce(m.confirmed_paid_amount,0)::text,p.payment_id,p.import_key,p.amount::text,p.payment_date,p.payment_mode,
         p.payment_reference,p.note,p.verification_status
  from input i
  join public.receivables r on r.distributor_id=i.distributor_id and r.bill_reference_key=i.bill_reference_key
  left join lateral (
    select coalesce(sum(rp.amount) filter(where rp.verification_status='confirmed'),0)::numeric(14,2) as confirmed_paid_amount
    from public.receivable_payments rp where rp.receivable_id=r.receivable_id
  ) m on true
  left join public.receivable_payments p on p.receivable_id=r.receivable_id
    and lower(regexp_replace(btrim(p.import_key),'\s+',' ','g'))=i.import_key;
end $$;

revoke all on function public.resolve_distributor_master_payment_targets_v1(jsonb) from public,anon,authenticated;
grant execute on function public.resolve_distributor_master_payment_targets_v1(jsonb) to service_role;

create or replace function public.apply_distributor_master_payments_v1(p_actor_id uuid,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_row jsonb;
  v_receivable public.receivables%rowtype;
  v_existing public.receivable_payments%rowtype;
  v_receivable_id uuid;
  v_amount numeric(14,2);
  v_paid numeric(14,2);
  v_key text;
  v_created integer:=0;
  v_duplicates integer:=0;
  v_today date:=(now() at time zone 'Asia/Kolkata')::date;
begin
  if not exists(select 1 from public.users u where u.user_id=p_actor_id and u.is_active=true and public.receivables_is_admin(u.user_id)) then
    raise exception using errcode='42501',message='ADMIN_REQUIRED';
  end if;
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>5000 then
    raise exception using errcode='22023',message='MASTER_PAYMENT_ROWS_INVALID';
  end if;

  create temporary table master_payment_stage_v1(
    row_number integer primary key,
    payment_id uuid not null,
    receivable_id uuid not null,
    import_key text not null,
    import_key_normalized text not null,
    amount numeric(14,2) not null,
    payment_date date not null,
    payment_mode text,
    payment_reference text,
    note text,
    unique(receivable_id,import_key_normalized)
  ) on commit drop;

  for v_receivable_id in
    select distinct (value->>'receivable_id')::uuid from jsonb_array_elements(p_rows) order by 1
  loop
    perform 1 from public.receivables where receivable_id=v_receivable_id for update;
    if not found then raise exception using errcode='ZD104',message='MASTER_PAYMENT_RECEIVABLE_CHANGED'; end if;
  end loop;

  create temporary table master_payment_balance_v1 on commit drop as
  select r.receivable_id,r.bill_amount,r.next_follow_up_date,r.lifecycle_status,
         coalesce(sum(p.amount) filter(where p.verification_status='confirmed'),0)::numeric(14,2) as confirmed_paid
  from public.receivables r
  left join public.receivable_payments p on p.receivable_id=r.receivable_id
  where r.receivable_id in (select distinct (value->>'receivable_id')::uuid from jsonb_array_elements(p_rows))
  group by r.receivable_id,r.bill_amount,r.next_follow_up_date,r.lifecycle_status;
  create unique index master_payment_balance_v1_pk on master_payment_balance_v1(receivable_id);

  for v_row in select value from jsonb_array_elements(p_rows) order by (value->>'row_number')::integer loop
    if coalesce(v_row->>'amount','') !~ '^[0-9]{1,12}\.[0-9]{2}$'
       or char_length(btrim(v_row->>'import_key')) not between 1 and 160
       or char_length(coalesce(v_row->>'payment_mode',''))>60
       or char_length(coalesce(v_row->>'payment_reference',''))>160
       or char_length(coalesce(v_row->>'note',''))>1000 then
      raise exception using errcode='ZD104',message='MASTER_PAYMENT_ROW_INVALID';
    end if;
    v_receivable_id:=(v_row->>'receivable_id')::uuid;
    v_amount:=(v_row->>'amount')::numeric(14,2);
    v_key:=lower(regexp_replace(btrim(v_row->>'import_key'),'\s+',' ','g'));
    select * into v_receivable from public.receivables where receivable_id=v_receivable_id;
    if not found or v_receivable.lifecycle_status='cancelled' then
      raise exception using errcode='ZD104',message='MASTER_PAYMENT_RECEIVABLE_INELIGIBLE';
    end if;
    if (v_row->>'payment_date')::date>v_today then
      raise exception using errcode='ZD104',message='MASTER_PAYMENT_DATE_FUTURE';
    end if;

    select * into v_existing from public.receivable_payments
    where receivable_id=v_receivable_id
      and lower(regexp_replace(btrim(import_key),'\s+',' ','g'))=v_key;
    if found then
      if v_existing.verification_status='confirmed' and v_existing.amount=v_amount
         and v_existing.payment_date=(v_row->>'payment_date')::date
         and coalesce(btrim(v_existing.payment_mode),'')=coalesce(btrim(v_row->>'payment_mode'),'')
         and coalesce(btrim(v_existing.payment_reference),'')=coalesce(btrim(v_row->>'payment_reference'),'')
         and coalesce(v_existing.note,'')=coalesce(v_row->>'note','') then
        v_duplicates:=v_duplicates+1;
        continue;
      end if;
      raise exception using errcode='ZD104',message='MASTER_PAYMENT_IMPORT_KEY_CONFLICT';
    end if;

    if exists(select 1 from master_payment_stage_v1 where receivable_id=v_receivable_id and import_key_normalized=v_key) then
      raise exception using errcode='ZD104',message='MASTER_PAYMENT_IMPORT_KEY_REPEATED';
    end if;
    select confirmed_paid into v_paid from master_payment_balance_v1 where receivable_id=v_receivable_id;
    if v_amount<=0 or v_amount>v_receivable.bill_amount-v_paid then
      raise exception using errcode='ZD104',message='MASTER_PAYMENT_OVERPAYMENT';
    end if;
    insert into master_payment_stage_v1 values(
      (v_row->>'row_number')::integer,(v_row->>'payment_id')::uuid,v_receivable_id,btrim(v_row->>'import_key'),v_key,v_amount,
      (v_row->>'payment_date')::date,nullif(btrim(v_row->>'payment_mode'),''),nullif(btrim(v_row->>'payment_reference'),''),nullif(v_row->>'note','')
    );
    update master_payment_balance_v1 set confirmed_paid=confirmed_paid+v_amount where receivable_id=v_receivable_id;
  end loop;

  if exists(
    select 1 from master_payment_balance_v1
    where confirmed_paid<bill_amount and (next_follow_up_date is null or next_follow_up_date<v_today)
  ) then
    raise exception using errcode='ZD104',message='MASTER_PAYMENT_NEXT_FOLLOW_UP_REQUIRED';
  end if;

  insert into public.receivable_payments(
    payment_id,receivable_id,amount,payment_date,payment_mode,payment_reference,note,reported_by,
    verification_status,verified_by,verified_at,import_key
  )
  select payment_id,receivable_id,amount,payment_date,payment_mode,payment_reference,note,p_actor_id,
         'confirmed',p_actor_id,now(),import_key
  from master_payment_stage_v1 order by row_number;
  get diagnostics v_created=row_count;

  insert into public.receivable_activity_events(activity_id,receivable_id,actor_id,event_type,payment_id,note,change_set)
  select gen_random_uuid(),receivable_id,p_actor_id,'payment_confirmed',payment_id,note,
         jsonb_build_object('source','distributor_master_import','import_key',import_key,'row_number',row_number)
  from master_payment_stage_v1 order by row_number;

  update public.receivables r set
    next_follow_up_date=case when b.confirmed_paid=r.bill_amount then null else r.next_follow_up_date end,
    version=r.version+s.event_count,
    updated_at=now()
  from master_payment_balance_v1 b,
       (select receivable_id,count(*)::integer event_count from master_payment_stage_v1 group by receivable_id) s
  where r.receivable_id=b.receivable_id and r.receivable_id=s.receivable_id;

  drop table master_payment_stage_v1, master_payment_balance_v1;

  return jsonb_build_object('success',true,'created_count',v_created,'duplicate_count',v_duplicates);
exception when unique_violation then
  raise exception using errcode='ZD104',message='MASTER_PAYMENT_CONCURRENT_CONFLICT';
end $$;

revoke all on function public.apply_distributor_master_payments_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.apply_distributor_master_payments_v1(uuid,jsonb) to service_role;

-- A06 single transaction/receipt authority for the complete resolved plan.
create table public.distributor_master_import_batches(
  batch_id uuid primary key,
  operation_id uuid not null unique,
  actor_id uuid not null references public.users(user_id) on delete restrict,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  resolved_plan_hash text not null check (resolved_plan_hash ~ '^[0-9a-f]{64}$'),
  filename text not null check (char_length(btrim(filename)) between 1 and 255),
  distributor_row_count integer not null check (distributor_row_count between 0 and 5000),
  receivable_row_count integer not null check (receivable_row_count between 0 and 5000),
  payment_row_count integer not null check (payment_row_count between 0 and 5000),
  response jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.distributor_master_import_batches enable row level security;
revoke all on public.distributor_master_import_batches from public,anon,authenticated;
grant all on public.distributor_master_import_batches to service_role;

create or replace function public.import_distributor_master_v1(
  p_operation_id uuid,
  p_actor_id uuid,
  p_request_hash text,
  p_payload_hash text,
  p_resolved_plan_hash text,
  p_filename text,
  p_distributor_rows jsonb,
  p_receivable_rows jsonb,
  p_payment_rows jsonb
) returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_batch public.distributor_master_import_batches%rowtype;
  v_distributor_item jsonb;
  v_distributor_command jsonb;
  v_distributor_created integer:=0;
  v_distributor_updated integer:=0;
  v_distributor_duplicates integer:=0;
  v_distributor_result jsonb:=jsonb_build_object('success',true,'created_count',0,'updated_count',0,'duplicate_count',0);
  v_receivable_result jsonb:=jsonb_build_object('success',true,'created_count',0,'duplicate_count',0);
  v_payment_result jsonb:=jsonb_build_object('success',true,'created_count',0,'duplicate_count',0);
  v_result jsonb;
  v_receivable_apply_rows jsonb:='[]'::jsonb;
  v_today date:=(now() at time zone 'Asia/Kolkata')::date;
  v_receivable_operation_id uuid:=md5(p_operation_id::text||':receivables')::uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_operation_id::text,0));
  select * into v_batch from public.distributor_master_import_batches where operation_id=p_operation_id for update;
  if found then
    if v_batch.actor_id<>p_actor_id or v_batch.request_hash<>p_request_hash or v_batch.payload_hash<>p_payload_hash or v_batch.resolved_plan_hash<>p_resolved_plan_hash then
      return jsonb_build_object('success',false,'code','MASTER_OPERATION_MISMATCH');
    end if;
    return v_batch.response||jsonb_build_object('replayed',true);
  end if;
  if not exists(select 1 from public.users u where u.user_id=p_actor_id and u.is_active=true and public.receivables_is_admin(u.user_id)) then
    return jsonb_build_object('success',false,'code','ADMIN_REQUIRED');
  end if;
  if p_request_hash !~ '^[0-9a-f]{64}$' or p_payload_hash !~ '^[0-9a-f]{64}$' or p_resolved_plan_hash !~ '^[0-9a-f]{64}$'
     or jsonb_typeof(p_distributor_rows)<>'array' or jsonb_array_length(p_distributor_rows)>5000
     or jsonb_typeof(p_receivable_rows)<>'array' or jsonb_array_length(p_receivable_rows)>5000
     or jsonb_typeof(p_payment_rows)<>'array' or jsonb_array_length(p_payment_rows)>5000
     or jsonb_array_length(p_distributor_rows)+jsonb_array_length(p_receivable_rows)+jsonb_array_length(p_payment_rows)>5000
     or char_length(btrim(p_filename)) not between 1 and 255 then
    return jsonb_build_object('success',false,'code','MASTER_CONFIRMATION_INVALID');
  end if;

  begin
    insert into public.distributor_master_import_batches(
      batch_id,operation_id,actor_id,request_hash,payload_hash,resolved_plan_hash,filename,
      distributor_row_count,receivable_row_count,payment_row_count,response
    ) values(
      gen_random_uuid(),p_operation_id,p_actor_id,p_request_hash,p_payload_hash,p_resolved_plan_hash,btrim(p_filename),
      jsonb_array_length(p_distributor_rows),jsonb_array_length(p_receivable_rows),jsonb_array_length(p_payment_rows),'{}'::jsonb
    ) returning * into v_batch;

    if jsonb_array_length(p_distributor_rows)>0 then
      for v_distributor_item in
        select value from jsonb_array_elements(p_distributor_rows)
        order by (value->>'rowNumber')::integer
      loop
        if v_distributor_item->>'classification'='EXACT_DUPLICATE' then
          perform 1 from public.distributor_accounts
          where distributor_id=(v_distributor_item#>>'{payload,distributor_id}')::uuid
            and version=(v_distributor_item#>>'{payload,expected_version}')::bigint
          for update;
          if not found then
            raise exception using errcode='ZD106',message='MASTER_DISTRIBUTOR_CHANGED';
          end if;
          v_distributor_duplicates:=v_distributor_duplicates+1;
          continue;
        end if;
        if v_distributor_item->>'classification' not in ('NEW','UPDATE') then
          raise exception using errcode='ZD106',message='MASTER_DISTRIBUTOR_REVALIDATION_REQUIRED';
        end if;
        select public.distributor_status_command_v1(
          md5(p_operation_id::text||':distributor:'||(v_distributor_item->>'rowNumber'))::uuid,
          p_actor_id,
          case v_distributor_item->>'classification' when 'NEW' then 'create' else 'update' end,
          p_request_hash,
          v_distributor_item->'payload'
        ) into v_distributor_command;
        if not coalesce((v_distributor_command->>'success')::boolean,false) then
          raise exception using errcode='ZD106',message=coalesce(v_distributor_command->>'code','MASTER_DISTRIBUTOR_REJECTED');
        end if;
        if v_distributor_item->>'classification'='NEW' then
          v_distributor_created:=v_distributor_created+1;
        else
          v_distributor_updated:=v_distributor_updated+1;
        end if;
      end loop;
      v_distributor_result:=jsonb_build_object(
        'success',true,
        'created_count',v_distributor_created,
        'updated_count',v_distributor_updated,
        'duplicate_count',v_distributor_duplicates
      );
    end if;

    if jsonb_array_length(p_receivable_rows)>0 then
      if exists(
        with payment_totals as (
          select p.value->>'receivable_id' as receivable_id,
                 sum((p.value->>'amount')::numeric) as paid
          from jsonb_array_elements(p_payment_rows) p(value)
          where coalesce(p.value->>'amount','') ~ '^[0-9]{1,12}\.[0-9]{2}$'
          group by p.value->>'receivable_id'
        )
        select 1
        from jsonb_array_elements(p_receivable_rows) r(value)
        left join payment_totals totals on totals.receivable_id=r.value->>'receivable_id'
        where coalesce(totals.paid,0)<(r.value->>'bill_amount')::numeric
          and (case when coalesce(r.value->>'next_follow_up_date','') ~ '^\d{4}-\d{2}-\d{2}$'
                    then (r.value->>'next_follow_up_date')::date<v_today else true end)
      ) then
        raise exception using errcode='ZD106',message='MASTER_RECEIVABLE_NEXT_FOLLOW_UP_REQUIRED';
      end if;

      with payment_totals as (
        select p.value->>'receivable_id' as receivable_id,
               sum((p.value->>'amount')::numeric) as paid
        from jsonb_array_elements(p_payment_rows) p(value)
        where coalesce(p.value->>'amount','') ~ '^[0-9]{1,12}\.[0-9]{2}$'
        group by p.value->>'receivable_id'
      )
      select coalesce(jsonb_agg(
        case when coalesce(totals.paid,0)=(r.value->>'bill_amount')::numeric
               and (case when coalesce(r.value->>'next_follow_up_date','') ~ '^\d{4}-\d{2}-\d{2}$'
                         then (r.value->>'next_follow_up_date')::date<v_today else true end)
             then jsonb_set(r.value,'{next_follow_up_date}',to_jsonb(v_today::text))
             else r.value end
        order by r.ordinality
      ),'[]'::jsonb)
      into v_receivable_apply_rows
      from jsonb_array_elements(p_receivable_rows) with ordinality r(value,ordinality)
      left join payment_totals totals on totals.receivable_id=r.value->>'receivable_id';
      select public.import_receivables_v1(
        v_receivable_operation_id,p_actor_id,p_request_hash,p_filename,p_resolved_plan_hash,v_receivable_apply_rows
      ) into v_receivable_result;
      if not coalesce((v_receivable_result->>'success')::boolean,false) then
        raise exception using errcode='ZD106',message=coalesce(v_receivable_result->>'code','MASTER_RECEIVABLE_REJECTED');
      end if;
    end if;

    if jsonb_array_length(p_payment_rows)>0 then
      select public.apply_distributor_master_payments_v1(p_actor_id,p_payment_rows) into v_payment_result;
      if not coalesce((v_payment_result->>'success')::boolean,false) then
        raise exception using errcode='ZD106',message=coalesce(v_payment_result->>'code','MASTER_PAYMENT_REJECTED');
      end if;
    end if;

    v_result:=jsonb_build_object(
      'success',true,
      'batch_id',v_batch.batch_id,
      'operation_id',p_operation_id,
      'resolved_plan_hash',p_resolved_plan_hash,
      'distributors',v_distributor_result,
      'receivables',v_receivable_result,
      'payments',v_payment_result,
      'replayed',false
    );
    update public.distributor_master_import_batches set response=v_result where batch_id=v_batch.batch_id;
    return v_result;
  exception
    when sqlstate 'ZD101' or sqlstate 'ZD104' or sqlstate 'ZD106' then
      return jsonb_build_object('success',false,'code',sqlerrm);
  end;
end $$;

revoke all on function public.import_distributor_master_v1(uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.import_distributor_master_v1(uuid,uuid,text,text,text,text,jsonb,jsonb,jsonb) to service_role;

commit;
