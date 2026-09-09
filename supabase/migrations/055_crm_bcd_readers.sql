-- Additive read-only projections. Production application is Owner-only.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- One literal per-field predicate for the register and retained-event reader.
-- Pure scalar inputs: never pass an evidence-bearing Visit row or query inside it.
-- Every supported caller fixes search_path=pg_catalog,public (asserted in CI).
-- No helper-level SET: permit scalar inlining; actual plans must verify its cost.
create function public.crm_visit_matches_v1(
  v_date date, v_check_in timestamptz, v_user uuid, v_segment text, v_outcome text,
  search_fields text[], p_from date, p_to date, p_representative uuid,
  p_segment text, p_outcome text, p_search text, p_legacy_date date default null
) returns boolean language sql immutable security invoker as $$
  select
    (case when p_legacy_date is not null then
      -- Preserve getISTBusinessDayBounds' fixed +05:30 legacy contract even for old dates.
      v_date = p_legacy_date or (v_check_in >= (p_legacy_date::timestamp at time zone interval '+05:30')
        and v_check_in < ((p_legacy_date + 1)::timestamp at time zone interval '+05:30'))
      else (p_from is null or v_date >= p_from) and (p_to is null or v_date <= p_to) end)
    and (p_representative is null or v_user = p_representative)
    and (p_segment is null or v_segment = p_segment)
    and (p_outcome is null or v_outcome = p_outcome)
    and (coalesce(p_search, '') = ''
      or pg_catalog.strpos(pg_catalog.lower(search_fields[1]), pg_catalog.lower(p_search)) > 0
      or pg_catalog.strpos(pg_catalog.lower(search_fields[2]), pg_catalog.lower(p_search)) > 0
      or pg_catalog.strpos(pg_catalog.lower(search_fields[3]), pg_catalog.lower(p_search)) > 0
      or pg_catalog.strpos(pg_catalog.lower(search_fields[4]), pg_catalog.lower(p_search)) > 0
      or pg_catalog.strpos(pg_catalog.lower(search_fields[5]), pg_catalog.lower(p_search)) > 0
      or pg_catalog.strpos(pg_catalog.lower(search_fields[6]), pg_catalog.lower(p_search)) > 0
      or pg_catalog.strpos(pg_catalog.lower(search_fields[7]), pg_catalog.lower(p_search)) > 0
      or pg_catalog.strpos(pg_catalog.lower(search_fields[8]), pg_catalog.lower(p_search)) > 0);
$$;
revoke all on function public.crm_visit_matches_v1(date,timestamptz,uuid,text,text,text[],date,date,uuid,text,text,text,date) from public,anon,authenticated;
grant execute on function public.crm_visit_matches_v1(date,timestamptz,uuid,text,text,text[],date,date,uuid,text,text,text,date) to service_role;

-- Safe even when a retained Visit business reference is arbitrary legacy TEXT.
create function public.crm_visit_events_v1(
  p_from date, p_to date, p_representative uuid default null,
  p_segment text default null, p_outcome text default null, p_search text default '',
  p_after_date date default null, p_after_id uuid default null
) returns table (
  visit_id uuid, user_id uuid, visit_date date, check_in_time timestamptz,
  visit_outcome text, segment_type text
) language plpgsql stable security invoker set search_path = pg_catalog, public
set statement_timeout = '7s' as $$
begin
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 61
     or p_from < date '1000-02-01' or p_to > (current_timestamp at time zone 'Asia/Kolkata')::date
     or length(coalesce(p_search, '')) > 160
     or (p_segment is not null and p_segment not in ('Retailer','Distributor'))
     or (p_outcome is not null and p_outcome not in ('registered','installed','interested','follow_up','payment_follow_up','not_interested','payment_done'))
     or (p_after_date is null) <> (p_after_id is null)
     or (p_after_date is not null and p_after_date not between p_from and p_to) then
    raise exception 'INVALID_VISIT_RANGE' using errcode = '22023';
  end if;
  return query
  select v.visit_id, v.user_id, v.visit_date, v.check_in_time, v.visit_outcome, v.segment_type
  from public.field_visits v
  left join public.users u on u.user_id = v.user_id
  left join public.leads l on v.lead_id = l.lead_id::text
  where public.crm_visit_matches_v1(v.visit_date,v.check_in_time,v.user_id,v.segment_type,v.visit_outcome,
    array[u.name,u.email,l.business_name,l.contact_person,l.phone,v.visit_notes,v.person_met,v.address],
    p_from,p_to,p_representative,p_segment,p_outcome,p_search)
    and (p_after_id is null or (v.visit_date, v.visit_id) > (p_after_date, p_after_id))
  order by v.visit_date, v.visit_id
  limit 1000;
end $$;
revoke all on function public.crm_visit_events_v1(date,date,uuid,text,text,text,date,uuid) from public, anon, authenticated;
grant execute on function public.crm_visit_events_v1(date,date,uuid,text,text,text,date,uuid) to service_role;

-- The matched count and selected IDs come from one statement. Detail enrichment
-- remains a separate bounded live read; this is not a cross-request snapshot.
create function public.crm_visit_register_v1(
  p_from date default null, p_to date default null, p_representative uuid default null,
  p_segment text default null, p_outcome text default null, p_search text default '',
  p_legacy_date date default null, p_page integer default 1
) returns jsonb language plpgsql stable security invoker
set search_path = pg_catalog, public set statement_timeout = '7s' as $$
declare result jsonb;
begin
  if p_page is null or p_page < 1 or p_page > 400
    or (p_from is null) <> (p_to is null)
    or (p_legacy_date is not null and (p_from is not null or p_to is not null))
    or p_from > p_to or p_to - p_from > 30
    or least(p_from,p_legacy_date) < date '1000-02-01'
    or greatest(p_to,p_legacy_date) > (current_timestamp at time zone 'Asia/Kolkata')::date
    or length(coalesce(p_search,'')) > 160
    or (p_segment is not null and p_segment not in ('Retailer','Distributor'))
    or (p_outcome is not null and p_outcome not in ('registered','installed','interested','follow_up','payment_follow_up','not_interested','payment_done')) then
    raise exception 'INVALID_VISIT_REGISTER_SCOPE' using errcode = '22023';
  end if;
  with matched as materialized (
    select v.visit_id,v.created_at,v.visit_date
    from public.field_visits v
    left join public.users u on u.user_id=v.user_id
    left join public.leads l on v.lead_id=l.lead_id::text
    where public.crm_visit_matches_v1(v.visit_date,v.check_in_time,v.user_id,v.segment_type,v.visit_outcome,
      array[u.name,u.email,l.business_name,l.contact_person,l.phone,v.visit_notes,v.person_met,v.address],
      p_from,p_to,p_representative,p_segment,p_outcome,p_search,p_legacy_date)
  ), selected as (
    select visit_id,created_at from matched order by created_at desc,visit_id desc
    limit 50 offset ((p_page-1)*50)
  )
  select jsonb_build_object(
    'visit_ids',coalesce((select jsonb_agg(visit_id order by created_at desc,visit_id desc) from selected),'[]'::jsonb),
    'total',(select count(*) from matched), 'page',p_page,'page_size',50,
    'has_more',(select count(*) from matched)>p_page*50,
    'page_limit',400,
    'legacy_date_mismatch_count',(select count(*) from matched where p_legacy_date is not null and visit_date is distinct from p_legacy_date)
  ) into result;
  return result;
end $$;
revoke all on function public.crm_visit_register_v1(date,date,uuid,text,text,text,date,integer) from public,anon,authenticated;
grant execute on function public.crm_visit_register_v1(date,date,uuid,text,text,text,date,integer) to service_role;

-- Independent historical/current membership, not a directory built by draining visits.
create function public.crm_visit_representatives_v1(
  p_search text default '', p_after_name text default null,
  p_after_id uuid default null, p_selected uuid default null
) returns jsonb language plpgsql stable security invoker
set search_path = pg_catalog, public set statement_timeout = '7s' as $$
declare result jsonb;
begin
  if length(coalesce(p_search,'')) > 160 or length(coalesce(p_after_name,'')) > 1000
    or (p_after_name is null) <> (p_after_id is null) then
    raise exception 'INVALID_REPRESENTATIVE_SCOPE' using errcode = '22023';
  end if;
  with members as not materialized (
    -- Bound the sort key, not the visible identity; UUID resolves prefix ties.
    select u.user_id,u.name,u.email,u.is_active,left(lower(coalesce(u.name,'')),1000) as cursor_name,
      not exists(select 1 from public.user_capabilities c where c.user_id=u.user_id and c.capability_code in ('field_ret','field_dist')) as historical_only
    from public.users u
    where exists(select 1 from public.user_capabilities c where c.user_id=u.user_id and c.capability_code in ('field_ret','field_dist'))
      or exists(select 1 from public.field_visits v where v.user_id=u.user_id)
  ), page as materialized (
    select * from members
    where (coalesce(p_search,'')='' or strpos(lower(name),lower(p_search))>0 or strpos(lower(email),lower(p_search))>0)
      and (p_after_id is null or (cursor_name,user_id) > (p_after_name,p_after_id))
    order by cursor_name,user_id limit 26
  ), shown as (
    select * from page order by cursor_name,user_id limit 25
  )
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(to_jsonb(shown) order by cursor_name,user_id) from shown),'[]'::jsonb),
    'has_more',(select count(*) from page)>25,
    'selected',(select to_jsonb(members) from members where user_id=p_selected)
  ) into result;
  if octet_length(result::text)>65536 then raise exception 'REPRESENTATIVE_PAYLOAD_LIMIT' using errcode='54000'; end if;
  return result;
end $$;
revoke all on function public.crm_visit_representatives_v1(text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.crm_visit_representatives_v1(text,text,uuid,uuid) to service_role;

notify pgrst, 'reload schema';
commit;
