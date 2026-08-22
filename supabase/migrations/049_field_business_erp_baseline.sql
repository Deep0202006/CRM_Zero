begin;

-- CRM-P1-049: Admin-supplied current ERP enrichment. This table is deliberately
-- created empty: historical visits remain observations and are never backfilled or
-- rewritten by this migration.
create table public.field_business_erp_baselines (
  segment_type text not null check (segment_type in ('Retailer','Distributor')),
  business_ref text not null check (char_length(btrim(business_ref)) between 1 and 256 and business_ref=btrim(business_ref)),
  erp_usage_state text null check (erp_usage_state is null or erp_usage_state in ('erp','none')),
  erp_id uuid null references public.erp_systems(erp_id) on delete restrict,
  updated_by uuid not null references public.users(user_id) on delete restrict,
  updated_at timestamptz not null default now(),
  primary key (segment_type,business_ref),
  constraint field_business_erp_baseline_value_valid check (
    (erp_usage_state is null and erp_id is null)
    or (erp_usage_state='erp' and erp_id is not null)
    or (erp_usage_state='none' and erp_id is null)
  )
);

alter table public.field_business_erp_baselines enable row level security;
revoke all on public.field_business_erp_baselines from public,anon,authenticated;
grant all on public.field_business_erp_baselines to service_role;

-- Applies a whole Admin edit batch in this function transaction. Every operation
-- and every referenced visited-business identity is validated before ERP rows or
-- baseline rows are changed. "clear" deletes only this manual authority.
create or replace function public.set_field_business_erp_baselines_v1(
  p_actor_id uuid,
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_count integer;
  v_now timestamptz := clock_timestamp();
begin
  if not exists (
    select 1 from public.users u
    where u.user_id=p_actor_id and u.is_active=true
      and public.receivables_is_admin(u.user_id)
  ) then
    return jsonb_build_object('success',false,'code','ADMIN_REQUIRED');
  end if;

  if p_rows is null or jsonb_typeof(p_rows)<>'array'
     or jsonb_array_length(p_rows) not between 1 and 500 then
    return jsonb_build_object('success',false,'code','BATCH_SIZE_INVALID');
  end if;

  -- ON COMMIT DROP does not run between repeated RPC calls made inside the
  -- same transaction, so discard only this session-local staging table first.
  drop table if exists pg_temp.field_business_erp_batch;
  create temporary table field_business_erp_batch (
    ordinal integer not null,
    segment_type text,
    business_ref text,
    operation text,
    erp_id_text text,
    erp_name text,
    erp_key text,
    resolved_erp_id uuid,
    primary key(segment_type,business_ref)
  ) on commit drop;

  insert into field_business_erp_batch(ordinal,segment_type,business_ref,operation,erp_id_text,erp_name,erp_key)
  select
    e.ordinality::integer,
    e.value->>'segment_type',
    btrim(coalesce(e.value->>'business_ref','')),
    lower(coalesce(e.value->>'operation','')),
    nullif(btrim(coalesce(e.value->>'erp_id','')),''),
    nullif(regexp_replace(btrim(coalesce(e.value->>'erp_name','')),'\s+',' ','g'),''),
    case when nullif(btrim(coalesce(e.value->>'erp_name','')),'') is not null
      then public.erp_normalized_key_v1(e.value->>'erp_name') end
  from jsonb_array_elements(p_rows) with ordinality e(value,ordinality);

  -- A primary-key conflict above is also a safe all-or-nothing rejection. These
  -- checks return typed failures before any durable write occurs.
  if exists(select 1 from field_business_erp_batch where segment_type not in ('Retailer','Distributor')) then
    return jsonb_build_object('success',false,'code','SEGMENT_INVALID');
  end if;
  if exists(select 1 from field_business_erp_batch where char_length(business_ref) not between 1 and 256) then
    return jsonb_build_object('success',false,'code','BUSINESS_REF_INVALID');
  end if;
  if exists(select 1 from field_business_erp_batch where operation not in ('set','none','clear')) then
    return jsonb_build_object('success',false,'code','OPERATION_INVALID');
  end if;
  if exists (
    select 1 from field_business_erp_batch b
    where not exists (
      select 1 from public.field_visits f
      where f.segment_type=b.segment_type and f.lead_id=b.business_ref
    )
  ) then
    return jsonb_build_object('success',false,'code','BUSINESS_NOT_VISITED');
  end if;
  if exists (
    select 1 from field_business_erp_batch
    where (operation='set' and ((erp_id_text is null)=(erp_name is null)))
       or (operation in ('none','clear') and (erp_id_text is not null or erp_name is not null))
       or (erp_name is not null and (char_length(erp_name) not between 1 and 160 or lower(erp_name)='none'))
  ) then
    return jsonb_build_object('success',false,'code','ERP_INPUT_INVALID');
  end if;
  if exists (
    select 1 from field_business_erp_batch b
    where b.erp_id_text is not null
      and (b.erp_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or not exists(select 1 from public.erp_systems e where e.erp_id=b.erp_id_text::uuid))
  ) then
    return jsonb_build_object('success',false,'code','ERP_INVALID');
  end if;

  -- Serialize canonical-name creation and the affected exact business identities.
  perform pg_advisory_xact_lock(hashtextextended('field-business-erp:'||erp_key,0))
  from (select distinct erp_key from field_business_erp_batch where erp_key is not null order by erp_key) keys;
  perform pg_advisory_xact_lock(hashtextextended('field-business-erp:'||segment_type||':'||business_ref,0))
  from field_business_erp_batch order by segment_type,business_ref;

  insert into public.erp_systems(erp_id,erp_name,erp_key,created_by)
  select md5('erp:'||b.erp_key)::uuid,min(b.erp_name),b.erp_key,p_actor_id
  from field_business_erp_batch b
  where b.operation='set' and b.erp_key is not null
  group by b.erp_key
  on conflict(erp_key) do nothing;

  update field_business_erp_batch b
  set resolved_erp_id=coalesce(b.erp_id_text::uuid,e.erp_id)
  from public.erp_systems e
  where (b.erp_key is not null and e.erp_key=b.erp_key)
     or (b.erp_id_text is not null and e.erp_id=b.erp_id_text::uuid);

  insert into public.field_business_erp_baselines(
    segment_type,business_ref,erp_usage_state,erp_id,updated_by,updated_at
  )
  select segment_type,business_ref,
    case when operation='none' then 'none' else 'erp' end,
    case when operation='set' then resolved_erp_id else null end,
    p_actor_id,v_now
  from field_business_erp_batch
  where operation in ('set','none')
  on conflict(segment_type,business_ref) do update set
    erp_usage_state=excluded.erp_usage_state,
    erp_id=excluded.erp_id,
    updated_by=excluded.updated_by,
    updated_at=excluded.updated_at;
  get diagnostics v_count=row_count;

  delete from public.field_business_erp_baselines x
  using field_business_erp_batch b
  where b.operation='clear' and x.segment_type=b.segment_type and x.business_ref=b.business_ref;

  return jsonb_build_object('success',true,'operation_count',jsonb_array_length(p_rows),'upserted_count',v_count);
exception
  when unique_violation then
    return jsonb_build_object('success',false,'code','DUPLICATE_BUSINESS');
  when invalid_text_representation then
    return jsonb_build_object('success',false,'code','ERP_INVALID');
end;
$$;

revoke all on function public.set_field_business_erp_baselines_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.set_field_business_erp_baselines_v1(uuid,jsonb) to service_role;

-- Bounded exact-identity projection for Admin editing. It intentionally has no
-- fuzzy identity matching: business_ref is the stable field-visit identity.
create or replace function public.field_business_erp_current_v2(
  p_segment_type text default null,
  p_business_ref text default null,
  p_limit integer default 500
) returns table (
  segment_type text,
  business_ref text,
  erp_usage_state text,
  erp_id uuid,
  erp_name text,
  latest_visit_at timestamptz,
  effective_at timestamptz,
  provenance text,
  source_ref text
)
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  with businesses as (
    select f.segment_type,f.lead_id business_ref,max(f.check_in_time) latest_visit_at
    from public.field_visits f
    where f.segment_type in ('Retailer','Distributor')
      and (p_segment_type is null or f.segment_type=p_segment_type)
      and (p_business_ref is null or f.lead_id=p_business_ref)
    group by f.segment_type,f.lead_id
  ), visit_latest as (
    select distinct on (f.segment_type,f.lead_id)
      f.segment_type,f.lead_id business_ref,f.erp_usage_state,f.erp_id,
      f.check_in_time effective_at,f.visit_id::text source_ref
    from public.field_visits f join businesses b
      on b.segment_type=f.segment_type and b.business_ref=f.lead_id
    where f.erp_usage_state in ('erp','none')
    order by f.segment_type,f.lead_id,f.check_in_time desc,f.created_at desc,f.visit_id desc
  ), candidates as (
    select v.segment_type,v.business_ref,v.erp_usage_state,v.erp_id,v.effective_at,
      'field_visit'::text provenance,v.source_ref,1 source_priority
    from visit_latest v
    union all
    select x.segment_type,x.business_ref,x.erp_usage_state,x.erp_id,x.updated_at,
      'manual_baseline'::text,null::text,2 source_priority
    from public.field_business_erp_baselines x join businesses b using(segment_type,business_ref)
    where x.erp_usage_state in ('erp','none')
  ), current_value as (
    select distinct on (c.segment_type,c.business_ref)
      c.segment_type,c.business_ref,c.erp_usage_state,c.erp_id,c.effective_at,c.provenance,c.source_ref
    from candidates c
    order by c.segment_type,c.business_ref,c.effective_at desc,c.source_priority desc,c.source_ref desc nulls last
  )
  select b.segment_type,b.business_ref,c.erp_usage_state,c.erp_id,e.erp_name,b.latest_visit_at,c.effective_at,
    coalesce(c.provenance,'not_captured') provenance,c.source_ref
  from businesses b
  left join current_value c using(segment_type,business_ref)
  left join public.erp_systems e on e.erp_id=c.erp_id
  order by b.segment_type,b.business_ref
  limit greatest(1,least(coalesce(p_limit,500),500));
$$;

revoke all on function public.field_business_erp_current_v2(text,text,integer) from public,anon,authenticated;
grant execute on function public.field_business_erp_current_v2(text,text,integer) to service_role;

-- V2 chooses one current value per exact visited business. A manual baseline and
-- a visit observation participate by their own capture time; deterministic source
-- priority resolves the unlikely exact timestamp tie. NULL visit data remains
-- "Not captured" and is never interpreted as explicit None.
create or replace function public.field_visit_erp_intelligence_v2()
returns jsonb
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  with businesses as (
    select distinct f.segment_type,f.lead_id business_ref
    from public.field_visits f
    where f.segment_type in ('Retailer','Distributor')
  ), visit_latest as (
    select distinct on (f.segment_type,f.lead_id)
      f.segment_type,f.lead_id business_ref,f.erp_usage_state,f.erp_id,
      f.check_in_time effective_at,f.visit_id source_ref
    from public.field_visits f
    where f.segment_type in ('Retailer','Distributor')
      and f.erp_usage_state in ('erp','none')
    order by f.segment_type,f.lead_id,f.check_in_time desc,f.created_at desc,f.visit_id desc
  ), candidates as (
    select v.segment_type,v.business_ref,v.erp_usage_state,v.erp_id,v.effective_at,
      'field_visit'::text provenance,v.source_ref::text source_ref,1 source_priority
    from visit_latest v
    union all
    select b.segment_type,b.business_ref,b.erp_usage_state,b.erp_id,b.updated_at,
      'manual_baseline'::text provenance,null::text source_ref,2 source_priority
    from public.field_business_erp_baselines b
    join businesses x using(segment_type,business_ref)
    where b.erp_usage_state in ('erp','none')
  ), current_value as (
    select distinct on (c.segment_type,c.business_ref)
      c.segment_type,c.business_ref,c.erp_usage_state,c.erp_id,c.effective_at,
      c.provenance,c.source_ref
    from candidates c
    order by c.segment_type,c.business_ref,c.effective_at desc,c.source_priority desc,c.source_ref desc nulls last
  ), categorized as (
    select b.segment_type,b.business_ref,c.erp_id,e.erp_name,c.effective_at,c.provenance,c.source_ref,
      case when c.erp_usage_state='erp' then 'erp'
           when c.erp_usage_state='none' then 'none'
           else 'not_captured' end state,
      case when c.erp_usage_state='erp' then e.erp_name
           when c.erp_usage_state='none' then 'None'
           else 'Not captured' end category
    from businesses b
    left join current_value c using(segment_type,business_ref)
    left join public.erp_systems e on e.erp_id=c.erp_id
  ), segments as (
    select unnest(array['Retailer','Distributor']) segment_type
  ), totals as (
    select segment_type,count(*) unique_businesses,
      count(*) filter(where state<>'not_captured') observed_count,
      count(*) filter(where state='erp') erp_using_count,
      count(*) filter(where state='none') none_count,
      count(*) filter(where state='not_captured') not_captured_count
    from categorized group by segment_type
  )
  select jsonb_object_agg(s.segment_type,jsonb_build_object(
    'unique_businesses',coalesce(t.unique_businesses,0),
    'observed_count',coalesce(t.observed_count,0),
    'erp_using_count',coalesce(t.erp_using_count,0),
    'none_count',coalesce(t.none_count,0),
    'not_captured_count',coalesce(t.not_captured_count,0),
    'coverage_percent',case when coalesce(t.unique_businesses,0)=0 then 0 else round(100.0*t.observed_count/t.unique_businesses,1) end,
    'categories',coalesce((
      select jsonb_agg(jsonb_build_object(
        'erp_name',c.category,'state',c.state,'count',c.count,
        'share_percent',case when t.unique_businesses=0 then 0 else round(100.0*c.count/t.unique_businesses,1) end
      ) order by c.count desc,c.category asc)
      from (select category,state,count(*) count from categorized where segment_type=s.segment_type group by category,state)c
    ),'[]'::jsonb),
    'provenance',coalesce((
      select jsonb_agg(jsonb_build_object(
        'source',c.provenance,'count',c.count
      ) order by c.provenance)
      from (select coalesce(provenance,'not_captured') provenance,count(*) count from categorized where segment_type=s.segment_type group by coalesce(provenance,'not_captured')) c
    ),'[]'::jsonb)
  ))
  from segments s left join totals t using(segment_type);
$$;

revoke all on function public.field_visit_erp_intelligence_v2() from public,anon,authenticated;
grant execute on function public.field_visit_erp_intelligence_v2() to service_role;

commit;
