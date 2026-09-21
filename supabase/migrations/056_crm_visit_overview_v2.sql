-- Additive read-only Visits Overview readers. Production application is Owner-only.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create function public.crm_visit_summary_v1(
  p_from date default null, p_to date default null, p_representative uuid default null,
  p_segment text default null, p_outcome text default null, p_search text default ''
) returns jsonb language plpgsql stable security invoker
set search_path = pg_catalog, public set statement_timeout = '7s' as $$
declare result jsonb;
begin
  if (p_from is null) <> (p_to is null)
    or p_from > p_to or p_from < date '1000-02-01'
    or p_to > (current_timestamp at time zone 'Asia/Kolkata')::date
    or length(coalesce(p_search,'')) > 160
    or (p_segment is not null and p_segment not in ('Retailer','Distributor'))
    or (p_outcome is not null and p_outcome not in ('registered','installed','interested','follow_up','payment_follow_up','not_interested','payment_done')) then
    raise exception 'INVALID_VISIT_SUMMARY_SCOPE' using errcode='22023';
  end if;
  with matched as materialized (
    select v.visit_id,v.user_id,v.visit_date,v.check_in_time,v.visit_outcome,u.name
    from public.field_visits v
    left join public.users u on u.user_id=v.user_id
    left join public.leads l on v.lead_id=l.lead_id::text
    where public.crm_visit_matches_v1(v.visit_date,v.check_in_time,v.user_id,v.segment_type,v.visit_outcome,
      array[u.name,u.email,l.business_name,l.contact_person,l.phone,v.visit_notes,v.person_met,v.address],
      p_from,p_to,p_representative,p_segment,p_outcome,p_search)
  ), integrity as materialized (
    select count(*)::bigint total,
      count(*) filter(where visit_date is null)::bigint undated,
      count(*) filter(where visit_date is not null and (check_in_time at time zone 'Asia/Kolkata')::date is distinct from visit_date)::bigint mismatches,
      coalesce(p_from,min(visit_date)) scope_start,coalesce(p_to,max(visit_date)) scope_end
    from matched
  ), settings as materialized (
    select *,case when scope_start is null then null else (scope_end-scope_start+1)::integer end span_days,
      case when scope_start is null then null else greatest(1,((scope_end-scope_start+1)+365)/366)::integer end bucket_days
    from integrity
  ), positions as materialized (
    select g.i,(s.scope_start+g.i*s.bucket_days)::date start_date,
      least(s.scope_end,(s.scope_start+g.i*s.bucket_days+s.bucket_days-1)::date) end_date
    from settings s cross join lateral generate_series(0,
      case when s.span_days is null then -1 else (s.span_days-1)/s.bucket_days end) g(i)
  ), bucket_counts as materialized (
    select ((m.visit_date-s.scope_start)/s.bucket_days)::integer i,count(*)::bigint count
    from matched m cross join settings s where m.visit_date is not null group by 1
  ), representative_counts as materialized (
    select user_id,max(name) name,count(*)::bigint count from matched group by user_id
  )
  select jsonb_build_object(
    'filtered_total',s.total,
    'outcomes',jsonb_build_object(
      'registered',count(*) filter(where m.visit_outcome='registered'),
      'installed',count(*) filter(where m.visit_outcome='installed'),
      'interested',count(*) filter(where m.visit_outcome='interested'),
      'follow_up',count(*) filter(where m.visit_outcome='follow_up'),
      'payment_follow_up',count(*) filter(where m.visit_outcome='payment_follow_up'),
      'payment_done',count(*) filter(where m.visit_outcome='payment_done'),
      'not_interested',count(*) filter(where m.visit_outcome='not_interested')
    ),
    'unknown_outcome_count',count(*) filter(where m.visit_id is not null and (m.visit_outcome is null or m.visit_outcome not in ('registered','installed','interested','follow_up','payment_follow_up','payment_done','not_interested'))),
    'scope_start_date',s.scope_start,'scope_end_date',s.scope_end,'bucket_days',s.bucket_days,
    'activity',coalesce((select jsonb_agg(jsonb_build_object('start_date',p.start_date,'end_date',p.end_date,'count',coalesce(b.count,0)) order by p.i)
      from positions p left join bucket_counts b using(i)),'[]'::jsonb),
    'date_mismatch_count',s.mismatches,
    'representatives',case when (select count(*) from representative_counts)>200 then null else
      coalesce((select jsonb_agg(jsonb_build_object('user_id',r.user_id,'name',r.name,'count',r.count) order by lower(coalesce(r.name,'')),r.user_id) from representative_counts r),'[]'::jsonb) end,
    'representative_breakdown',case when (select count(*) from representative_counts)>200 then 'unavailable-cardinality-limit' else 'exhausted' end,
    'undated_count',s.undated
  ) into result
  from settings s left join matched m on true group by s.total,s.mismatches,s.scope_start,s.scope_end,s.bucket_days,s.undated;
  if (result->>'filtered_total')::bigint < 0 then raise exception 'VISIT_SUMMARY_COUNT_OVERFLOW' using errcode='22003'; end if;
  if (result->>'undated_count')::bigint > 0 then raise exception 'VISIT_DATE_INTEGRITY_UNAVAILABLE' using errcode='23514'; end if;
  result:=result-'undated_count';
  if result is null or octet_length(result::text)>1048576 then raise exception 'VISIT_SUMMARY_PAYLOAD_LIMIT' using errcode='54000'; end if;
  return result;
end $$;
revoke all on function public.crm_visit_summary_v1(date,date,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.crm_visit_summary_v1(date,date,uuid,text,text,text) to service_role;

create function public.crm_visit_register_v2(
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
    or p_from > p_to or least(p_from,p_legacy_date) < date '1000-02-01'
    or greatest(p_to,p_legacy_date) > (current_timestamp at time zone 'Asia/Kolkata')::date
    or length(coalesce(p_search,'')) > 160
    or (p_segment is not null and p_segment not in ('Retailer','Distributor'))
    or (p_outcome is not null and p_outcome not in ('registered','installed','interested','follow_up','payment_follow_up','not_interested','payment_done')) then
    raise exception 'INVALID_VISIT_REGISTER_SCOPE' using errcode='22023';
  end if;
  with matched as materialized (
    select v.visit_id,v.created_at,v.visit_date
    from public.field_visits v left join public.users u on u.user_id=v.user_id left join public.leads l on v.lead_id=l.lead_id::text
    where public.crm_visit_matches_v1(v.visit_date,v.check_in_time,v.user_id,v.segment_type,v.visit_outcome,
      array[u.name,u.email,l.business_name,l.contact_person,l.phone,v.visit_notes,v.person_met,v.address],
      p_from,p_to,p_representative,p_segment,p_outcome,p_search,p_legacy_date)
  ), selected as (
    select visit_id,created_at from matched order by created_at desc,visit_id desc limit 50 offset ((p_page-1)*50)
  )
  select jsonb_build_object(
    'visit_ids',coalesce((select jsonb_agg(visit_id order by created_at desc,visit_id desc) from selected),'[]'::jsonb),
    'total',(select count(*) from matched),'page',p_page,'page_size',50,
    'has_more',(select count(*) from matched)>p_page*50,'page_limit',400,
    'legacy_date_mismatch_count',(select count(*) from matched where p_legacy_date is not null and visit_date is distinct from p_legacy_date)
  ) into result;
  return result;
end $$;
revoke all on function public.crm_visit_register_v2(date,date,uuid,text,text,text,date,integer) from public,anon,authenticated;
grant execute on function public.crm_visit_register_v2(date,date,uuid,text,text,text,date,integer) to service_role;

create function public.crm_visit_export_v2(
  p_from date default null, p_to date default null, p_representative uuid default null,
  p_segment text default null, p_outcome text default null, p_search text default '',
  p_legacy_date date default null, p_after_created timestamptz default null, p_after_id uuid default null
) returns jsonb language plpgsql stable security invoker
set search_path = pg_catalog, public set statement_timeout = '7s' as $$
declare result jsonb;
begin
  if (p_from is null) <> (p_to is null)
    or (p_legacy_date is not null and (p_from is not null or p_to is not null))
    or p_from > p_to or least(p_from,p_legacy_date) < date '1000-02-01'
    or greatest(p_to,p_legacy_date) > (current_timestamp at time zone 'Asia/Kolkata')::date
    or length(coalesce(p_search,'')) > 160
    or (p_segment is not null and p_segment not in ('Retailer','Distributor'))
    or (p_outcome is not null and p_outcome not in ('registered','installed','interested','follow_up','payment_follow_up','not_interested','payment_done'))
    or (p_after_created is null) <> (p_after_id is null)
    or (p_after_created is not null and not isfinite(p_after_created)) then
    raise exception 'INVALID_VISIT_EXPORT_SCOPE' using errcode='22023';
  end if;
  with export_selected as materialized (
    select v.visit_id,v.created_at,v.user_id,v.lead_id,v.visit_date,v.check_in_time,
      v.check_in_lat,v.check_in_lng,v.address,v.pincode,v.segment_type,v.person_met,
      v.visit_outcome,v.visit_notes,v.follow_up_date,v.erp_usage_state,e.erp_name,
      u.name representative_name,u.email representative_email,l.business_name,
      case when v.selfie_purged_at is not null then 'expired' when v.selfie_storage_path is not null then 'available' else 'pending' end selfie_status
    from public.field_visits v left join public.users u on u.user_id=v.user_id
    left join public.leads l on v.lead_id=l.lead_id::text left join public.erp_systems e on e.erp_id=v.erp_id
    where public.crm_visit_matches_v1(v.visit_date,v.check_in_time,v.user_id,v.segment_type,v.visit_outcome,
      array[u.name,u.email,l.business_name,l.contact_person,l.phone,v.visit_notes,v.person_met,v.address],
      p_from,p_to,p_representative,p_segment,p_outcome,p_search,p_legacy_date)
      and (p_after_id is null or (v.created_at,v.visit_id)<(p_after_created,p_after_id))
    order by v.created_at desc,v.visit_id desc limit 500
  ), export_budget as materialized (
    select coalesce(sum(case when greatest(length(s.representative_name),length(s.representative_email),length(s.business_name),length(s.lead_id),
      length(s.address),length(s.pincode),length(s.person_met),length(s.visit_outcome),length(s.visit_notes),length(s.segment_type),length(s.erp_name))>32767
      then 1048577 else 64+octet_length(to_jsonb(s)::text) end),0) bytes from export_selected s
  )
  select case when b.bytes>1048576 then null else (select coalesce(jsonb_agg(to_jsonb(s) || jsonb_build_object(
    'created_at',to_char(s.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) order by s.created_at desc,s.visit_id desc),'[]'::jsonb)
    from export_selected s) end into result from export_budget b;
  if result is null or octet_length(result::text)>1048576 then raise exception 'VISIT_EXPORT_PAGE_LIMIT' using errcode='54000'; end if;
  return result;
end $$;
revoke all on function public.crm_visit_export_v2(date,date,uuid,text,text,text,date,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.crm_visit_export_v2(date,date,uuid,text,text,text,date,timestamptz,uuid) to service_role;

notify pgrst, 'reload schema';
commit;
