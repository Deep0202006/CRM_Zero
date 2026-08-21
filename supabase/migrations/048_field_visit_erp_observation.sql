begin;

-- CRM-P1-048: ERP is a field-visit observation, never a Distributor Status mutation.
alter table public.field_visits
  add column erp_id uuid null references public.erp_systems(erp_id) on delete restrict,
  add column erp_usage_state text null;

alter table public.field_visits
  add constraint field_visits_erp_observation_valid check (
    (erp_usage_state is null and erp_id is null)
    or (erp_usage_state = 'none' and erp_id is null)
    or (erp_usage_state = 'erp' and erp_id is not null)
  );

-- The current-footprint aggregate partitions by segment and stable business identity,
-- then chooses the latest confirmed observation deterministically.
create index field_visits_erp_latest_business_idx
  on public.field_visits (segment_type, lead_id, check_in_time desc, created_at desc, visit_id desc);

create or replace function public.confirm_field_visit_erp_v1(p_actor_id uuid, p_visit jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  v_capabilities text[];
  v_segment text := p_visit->>'segment_type';
  v_usage text := p_visit->>'erp_usage_state';
  v_name text := regexp_replace(btrim(coalesce(p_visit->>'erp_name_input','')), '\s+', ' ', 'g');
  v_key text;
  v_erp public.erp_systems%rowtype;
  v_existing public.field_visits%rowtype;
  v_erp_id uuid;
begin
  if not exists(select 1 from public.users u where u.user_id=p_actor_id and u.is_active=true) then
    return jsonb_build_object('success',false,'code','ACCOUNT_INACTIVE');
  end if;
  select coalesce(array_agg(capability_code), array[]::text[]) into v_capabilities from public.user_capabilities where user_id=p_actor_id;
  if not ('admin'=any(v_capabilities) or (v_segment='Retailer' and 'field_ret'=any(v_capabilities)) or (v_segment='Distributor' and 'field_dist'=any(v_capabilities))) then
    return jsonb_build_object('success',false,'code','CAPABILITY_MISMATCH');
  end if;
  if v_usage not in ('erp','none') then return jsonb_build_object('success',false,'code','ERP_REQUIRED'); end if;
  if v_usage='erp' then
    if lower(v_name)='none' or char_length(v_name) not between 1 and 160 then return jsonb_build_object('success',false,'code','ERP_INVALID'); end if;
    v_key:=public.erp_normalized_key_v1(v_name);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(coalesce(p_visit->>'visit_id',''),0));
  select * into v_existing from public.field_visits where visit_id=(p_visit->>'visit_id')::uuid for update;
  if found then
    if v_existing.user_id<>p_actor_id then return jsonb_build_object('success',false,'code','VISIT_ID_OWNERSHIP_COLLISION'); end if;
    select erp_name into v_name from public.erp_systems where erp_id=v_existing.erp_id;
    return jsonb_build_object('success',true,'already_confirmed',true,'visit',to_jsonb(v_existing),'erp_id',v_existing.erp_id,'erp_name',v_name);
  end if;

  if v_usage='erp' then
    select * into v_erp from public.erp_systems where erp_key=v_key for update;
    if not found then
      insert into public.erp_systems(erp_id,erp_name,erp_key,created_by)
      values(md5('erp:'||v_key)::uuid,v_name,v_key,p_actor_id)
      on conflict(erp_key) do nothing returning * into v_erp;
      if not found then select * into v_erp from public.erp_systems where erp_key=v_key; end if;
    end if;
    v_erp_id:=v_erp.erp_id;
  end if;

  insert into public.field_visits(
    visit_id,lead_id,user_id,visit_date,check_in_time,check_in_lat,check_in_lng,check_in_photo_url,
    visit_outcome,visit_notes,attendance_id,person_met,address,address_contract_version,pincode,
    segment_type,follow_up_date,created_at,updated_at,location_accuracy_m,location_captured_at,
    location_acquisition_mode,location_quality,selfie_captured_at,selfie_capture_method,selfie_storage_path,
    erp_usage_state,erp_id
  ) values (
    (p_visit->>'visit_id')::uuid,p_visit->>'lead_id',p_actor_id,(p_visit->>'visit_date')::date,
    (p_visit->>'check_in_time')::timestamptz,nullif(p_visit->>'check_in_lat','')::double precision,
    nullif(p_visit->>'check_in_lng','')::double precision,nullif(p_visit->>'check_in_photo_url',''),
    p_visit->>'visit_outcome',nullif(p_visit->>'visit_notes',''),nullif(p_visit->>'attendance_id','')::uuid,
    nullif(p_visit->>'person_met',''),nullif(p_visit->>'address',''),1,nullif(p_visit->>'pincode',''),
    v_segment,nullif(p_visit->>'follow_up_date','')::date,(p_visit->>'created_at')::timestamptz,
    (p_visit->>'updated_at')::timestamptz,nullif(p_visit->>'location_accuracy_m','')::numeric,
    nullif(p_visit->>'location_captured_at','')::timestamptz,nullif(p_visit->>'location_acquisition_mode',''),
    nullif(p_visit->>'location_quality',''),nullif(p_visit->>'selfie_captured_at','')::timestamptz,
    nullif(p_visit->>'selfie_capture_method',''),null,v_usage,v_erp_id
  ) returning * into v_existing;
  return jsonb_build_object('success',true,'already_confirmed',false,'visit',to_jsonb(v_existing),'erp_id',v_erp_id,'erp_name',case when v_usage='erp' then v_erp.erp_name else null end);
end;
$$;

revoke all on function public.confirm_field_visit_erp_v1(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.confirm_field_visit_erp_v1(uuid,jsonb) to service_role;

create or replace function public.field_visit_erp_intelligence_v1()
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
  with latest as (
    select distinct on (f.segment_type,f.lead_id) f.segment_type,f.lead_id,f.erp_usage_state,f.erp_id
    from public.field_visits f
    where f.segment_type in ('Retailer','Distributor')
    order by f.segment_type,f.lead_id,f.check_in_time desc,f.created_at desc,f.visit_id desc
  ), categorized as (
    select l.segment_type,case when l.erp_usage_state='erp' then e.erp_name when l.erp_usage_state='none' then 'None' else 'Not captured' end category,
      case when l.erp_usage_state='erp' then 'erp' when l.erp_usage_state='none' then 'none' else 'not_captured' end state
    from latest l left join public.erp_systems e on e.erp_id=l.erp_id
  ), segments as (select unnest(array['Retailer','Distributor']) segment_type), totals as (
    select segment_type,count(*) unique_businesses,count(*) filter(where state<>'not_captured') observed_count,count(*) filter(where state='erp') erp_using_count,count(*) filter(where state='none') none_count,count(*) filter(where state='not_captured') not_captured_count from categorized group by segment_type
  ) select jsonb_object_agg(s.segment_type,jsonb_build_object('unique_businesses',coalesce(t.unique_businesses,0),'observed_count',coalesce(t.observed_count,0),'erp_using_count',coalesce(t.erp_using_count,0),'none_count',coalesce(t.none_count,0),'not_captured_count',coalesce(t.not_captured_count,0),'coverage_percent',case when coalesce(t.unique_businesses,0)=0 then 0 else round(100.0*t.observed_count/t.unique_businesses,1) end,'categories',coalesce((select jsonb_agg(jsonb_build_object('erp_name',c.category,'count',c.count,'share_percent',case when t.unique_businesses=0 then 0 else round(100.0*c.count/t.unique_businesses,1) end) order by c.count desc,c.category asc) from (select category,count(*) count from categorized where segment_type=s.segment_type group by category)c),'[]'::jsonb))) from segments s left join totals t using(segment_type);
$$;
revoke all on function public.field_visit_erp_intelligence_v1() from public,anon,authenticated;
grant execute on function public.field_visit_erp_intelligence_v1() to service_role;

commit;
