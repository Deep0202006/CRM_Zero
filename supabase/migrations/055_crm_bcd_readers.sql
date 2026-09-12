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

-- Export uses exactly the register predicate, but a bounded keyset, never browser-page loops.
-- Labels are joined here so enrichment cannot escape the operation's request budget.
create function public.crm_visit_export_v1(
  p_from date default null, p_to date default null, p_representative uuid default null,
  p_segment text default null, p_outcome text default null, p_search text default '',
  p_legacy_date date default null, p_after_created timestamptz default null, p_after_id uuid default null
) returns jsonb language plpgsql stable security invoker
set search_path = pg_catalog, public set statement_timeout = '7s' as $$
declare result jsonb;
begin
  if (p_legacy_date is null and (p_from is null or p_to is null))
    or (p_legacy_date is not null and (p_from is not null or p_to is not null))
    or p_from > p_to or p_to-p_from > 30
    or least(p_from,p_legacy_date) < date '1000-02-01'
    or greatest(p_to,p_legacy_date) > (current_timestamp at time zone 'Asia/Kolkata')::date
    or length(coalesce(p_search,'')) > 160
    or (p_segment is not null and p_segment not in ('Retailer','Distributor'))
    or (p_outcome is not null and p_outcome not in ('registered','installed','interested','follow_up','payment_follow_up','not_interested','payment_done'))
    or (p_after_created is null) <> (p_after_id is null)
    or (p_after_created is not null and not isfinite(p_after_created)) then
    raise exception 'INVALID_VISIT_EXPORT_SCOPE' using errcode = '22023';
  end if;
  with export_selected as materialized (
    select v.visit_id,v.created_at,v.user_id,v.lead_id,v.visit_date,v.check_in_time,
      v.check_in_lat,v.check_in_lng,v.address,v.pincode,v.segment_type,v.person_met,
      v.visit_outcome,v.visit_notes,v.follow_up_date,v.erp_usage_state,e.erp_name,
      u.name representative_name,u.email representative_email,l.business_name,
      case when v.selfie_purged_at is not null then 'expired'
        when v.selfie_storage_path is not null then 'available' else 'pending' end selfie_status
    from public.field_visits v
    left join public.users u on u.user_id=v.user_id
    left join public.leads l on v.lead_id=l.lead_id::text
    left join public.erp_systems e on e.erp_id=v.erp_id
    where public.crm_visit_matches_v1(v.visit_date,v.check_in_time,v.user_id,v.segment_type,v.visit_outcome,
      array[u.name,u.email,l.business_name,l.contact_person,l.phone,v.visit_notes,v.person_met,v.address],
      p_from,p_to,p_representative,p_segment,p_outcome,p_search,p_legacy_date)
      and (p_after_id is null or (v.created_at,v.visit_id)<(p_after_created,p_after_id))
    order by v.created_at desc,v.visit_id desc limit 500
  ), export_budget as materialized (
    -- Size each bounded row BEFORE building the aggregate, including JSON escapes.
    select coalesce(sum(case when greatest(length(s.representative_name),length(s.representative_email),
      length(s.business_name),length(s.lead_id),length(s.address),length(s.pincode),length(s.person_met),
      length(s.visit_outcome),length(s.visit_notes),length(s.segment_type),length(s.erp_name))>32767
      then 1048577 else 64+octet_length(to_jsonb(s)::text) end),0) bytes from export_selected s
  )
  select case when b.bytes>1048576 then null else (
    select coalesce(jsonb_agg(to_jsonb(s) || jsonb_build_object(
      'created_at',to_char(s.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
      order by s.created_at desc,s.visit_id desc),'[]'::jsonb) from export_selected s
  ) end into result from export_budget b;
  if result is null or octet_length(result::text)>1048576 then raise exception 'VISIT_EXPORT_PAGE_LIMIT' using errcode='54000'; end if;
  return result;
end $$;
revoke all on function public.crm_visit_export_v1(date,date,uuid,text,text,text,date,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.crm_visit_export_v1(date,date,uuid,text,text,text,date,timestamptz,uuid) to service_role;

-- Preserve048's latest observed business meaning, independently of the Visit range.
create function public.crm_visit_export_erp_v1()
returns jsonb language plpgsql stable security invoker
set search_path = pg_catalog, public set statement_timeout = '7s' as $$
declare result jsonb; catalog_count integer; catalog_invalid boolean;
begin
  -- Each category comes from the bounded160-character ERP catalog, plus None/Not captured.
  -- Check cardinality before048 constructs JSON, without draining the catalog to the app.
  select count(*),coalesce(bool_or(char_length(erp_name)>160),false)
    into catalog_count,catalog_invalid from (select erp_name from public.erp_systems limit 999) catalog;
  if catalog_count>998 or catalog_invalid then
    raise exception 'VISIT_EXPORT_ERP_LIMIT' using errcode='54000';
  end if;
  result:=public.field_visit_erp_intelligence_v1();
  if result is null or octet_length(result::text)>1048576
    or jsonb_array_length(result->'Retailer'->'categories')>1000
    or jsonb_array_length(result->'Distributor'->'categories')>1000 then
    raise exception 'VISIT_EXPORT_ERP_LIMIT' using errcode='54000';
  end if;
  return result;
end $$;
revoke all on function public.crm_visit_export_erp_v1() from public,anon,authenticated;
grant execute on function public.crm_visit_export_erp_v1() to service_role;

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

-- Shared literal search and facets for confirmed operational and Admin registers.
-- Inspection-only linked context is never requested by the ordinary lead route.
create function public.crm_pipeline_register_v1(
  p_segment text, p_search text default '', p_owner uuid default null,
  p_source text default null, p_stage text default null, p_page integer default 1,
  p_page_size integer default 50, p_inspection boolean default false,
  p_stale boolean default false, p_overdue boolean default false,
  p_recent boolean default false, p_as_of timestamptz default current_timestamp
) returns jsonb language plpgsql stable security invoker
set search_path = pg_catalog, public set statement_timeout = '7s' as $$
declare result jsonb;
begin
  if (p_segment is null and not p_inspection) or (p_segment is not null and p_segment not in ('Retailer','Distributor'))
    or length(coalesce(p_search,''))>80 or length(coalesce(p_source,''))>120
    or (p_stage is not null and p_stage not in ('New','Contacted','Interested','Not Interested','Registration','Installation','Payment','Converted','Renewal Due'))
    or p_page is null or p_page not between 1 and 400 or p_page_size is null or p_page_size not between 1 and 50
    or p_inspection is null or p_stale is null or p_overdue is null or p_recent is null
    or (not p_inspection and (p_stale or p_overdue or p_recent))
    or p_as_of is null or not isfinite(p_as_of) then
    raise exception 'INVALID_PIPELINE_REGISTER_SCOPE' using errcode='22023';
  end if;
  with base as materialized (
    select l.lead_id,l.business_name,l.contact_person,l.phone,l.segment_type,l.status,l.assigned_to,
      l.created_at,l.stage_entered_at,l.onboarded_at,l.lead_source,l.area
    from public.leads l
    where (p_segment is null or l.segment_type::text=p_segment)
      and (p_owner is null or l.assigned_to=p_owner)
      and (p_source is null or l.lead_source=p_source)
      and (coalesce(p_search,'')='' or strpos(lower(l.business_name),lower(p_search))>0
        or strpos(lower(l.contact_person),lower(p_search))>0 or strpos(lower(l.phone),lower(p_search))>0
        or strpos(lower(l.area),lower(p_search))>0)
  ), matched as materialized (
    select b.* from base b where (p_stage is null or b.status::text=p_stage)
      and (not p_stale or coalesce(b.stage_entered_at,b.created_at)<=p_as_of-interval '14 days')
      and (not p_overdue or exists(select 1 from public.tasks t where t.related_lead_id=b.lead_id
        and t.is_active and t.status not in ('Completed','Missed') and t.due_date<(p_as_of at time zone 'Asia/Kolkata')::date))
      and (not p_recent or exists(select 1 from public.pipeline_transition_operations o where o.lead_id=b.lead_id
        and o.confirmed_at>=p_as_of-interval '7 days' and o.confirmed_at<p_as_of))
  ), selected as (
    select * from matched order by created_at desc,lead_id desc limit p_page_size offset ((p_page-1)*p_page_size)
  ), enriched as materialized (
    select s.*,coalesce(u.name,'Unassigned') owner_name,
      task.value next_task,call_record.value recent_call,transition.value recent_transition
    from selected s left join public.users u on u.user_id=s.assigned_to
    left join lateral (select jsonb_build_object('task_id',t.task_id,'title',t.title,'status',t.status,'due_date',t.due_date,'priority',t.priority) value
      from public.tasks t where p_inspection and t.related_lead_id=s.lead_id and t.is_active and t.status not in ('Completed','Missed')
      order by t.due_date,t.task_id limit 1) task on true
    left join lateral (select jsonb_build_object('log_id',c.log_id,'outcome',c.outcome,'timestamp',c.timestamp) value
      from public.call_logs c where p_inspection and c.lead_id=s.lead_id
      order by c.timestamp desc,c.log_id desc limit 1) call_record on true
    left join lateral (select jsonb_build_object('operation_id',o.operation_id,'lead_id',o.lead_id,'expected_stage',o.expected_stage,'target_stage',o.target_stage,'confirmed_at',o.confirmed_at,'event_kind',o.event_kind,'reason',o.reason) value
      from public.pipeline_transition_operations o where p_inspection and o.lead_id=s.lead_id and o.confirmed_at<p_as_of
      order by o.confirmed_at desc,o.operation_id desc limit 1) transition on true
  ), sized as (
    select coalesce(sum(octet_length(to_jsonb(e)::text)),0) bytes from enriched e
  )
  select case when sized.bytes>900000 then null else jsonb_build_object(
    'leads',coalesce((select jsonb_agg(to_jsonb(e) order by created_at desc,lead_id desc) from enriched e),'[]'::jsonb),
    'total',(select count(*) from matched),'page',p_page,'page_size',p_page_size,
    'stages',coalesce((select jsonb_agg(jsonb_build_object('stage',status,'count',n)) from (select status,count(*) n from base group by status) counts),'[]'::jsonb)
  ) end into result from sized;
  if result is null or octet_length(result::text)>1048576 then raise exception 'PIPELINE_REGISTER_PAYLOAD_LIMIT' using errcode='54000'; end if;
  return result;
end $$;
revoke all on function public.crm_pipeline_register_v1(text,text,uuid,text,text,integer,integer,boolean,boolean,boolean,boolean,timestamptz) from public,anon,authenticated;
grant execute on function public.crm_pipeline_register_v1(text,text,uuid,text,text,integer,integer,boolean,boolean,boolean,boolean,timestamptz) to service_role;

-- Independent event populations: old leads with recent transitions are retained.
create function public.crm_pipeline_history_v1(p_segment text,p_from timestamptz,p_to timestamptz)
returns jsonb language plpgsql stable security invoker
set search_path = pg_catalog, public set statement_timeout = '7s' as $$
declare result jsonb;
begin
  if (p_segment is not null and p_segment not in ('Retailer','Distributor')) or p_from is null or p_to is null
    or not isfinite(p_from) or not isfinite(p_to) or p_from>=p_to or p_to-p_from>interval '367 days' then
    raise exception 'INVALID_PIPELINE_HISTORY_SCOPE' using errcode='22023';
  end if;
  with new_leads as materialized (
    select lead_id,created_at from public.leads
    where (p_segment is null or segment_type::text=p_segment) and created_at>=p_from and created_at<p_to
    order by created_at desc,lead_id desc limit 2001
  ), transitions as materialized (
    select o.operation_id,o.lead_id,o.actor_id,o.expected_stage,o.target_stage,
      to_char(o.confirmed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') confirmed_at,o.event_kind,o.reason
    from public.pipeline_transition_operations o join public.leads l on l.lead_id=o.lead_id
    where (p_segment is null or l.segment_type::text=p_segment) and o.confirmed_at>=p_from and o.confirmed_at<p_to
    order by o.confirmed_at desc,o.operation_id desc limit 2001
  ), shown_leads as (select * from new_leads order by created_at desc,lead_id desc limit 2000),
  shown_transitions as (select * from transitions order by confirmed_at desc,operation_id desc limit 2000),
  sized as (select coalesce((select sum(octet_length(to_jsonb(n)::text)) from shown_leads n),0)
    +coalesce((select sum(octet_length(to_jsonb(t)::text)) from shown_transitions t),0) bytes)
  select case when sized.bytes>1000000 then null else jsonb_build_object(
    'leads',coalesce((select jsonb_agg(to_jsonb(n) order by created_at desc,lead_id desc) from shown_leads n),'[]'::jsonb),
    'transitions',coalesce((select jsonb_agg(to_jsonb(t) order by confirmed_at desc,operation_id desc) from shown_transitions t),'[]'::jsonb),
    'lead_limited',(select count(*)>2000 from new_leads),'transition_limited',(select count(*)>2000 from transitions)
  ) end into result from sized;
  if result is null or octet_length(result::text)>1048576 then raise exception 'PIPELINE_HISTORY_PAYLOAD_LIMIT' using errcode='54000'; end if;
  return result;
end $$;
revoke all on function public.crm_pipeline_history_v1(text,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.crm_pipeline_history_v1(text,timestamptz,timestamptz) to service_role;

notify pgrst, 'reload schema';
commit;
