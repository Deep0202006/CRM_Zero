-- Additive read-only projections. Production application is Owner-only.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

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
  where v.visit_date between p_from and p_to
    and (p_representative is null or v.user_id = p_representative)
    and (p_segment is null or v.segment_type = p_segment)
    and (p_outcome is null or v.visit_outcome = p_outcome)
    and (coalesce(p_search, '') = ''
      or strpos(lower(u.name), lower(p_search)) > 0
      or strpos(lower(u.email), lower(p_search)) > 0
      or strpos(lower(l.business_name), lower(p_search)) > 0
      or strpos(lower(l.contact_person), lower(p_search)) > 0
      or strpos(lower(l.phone), lower(p_search)) > 0
      or strpos(lower(v.visit_notes), lower(p_search)) > 0
      or strpos(lower(v.person_met), lower(p_search)) > 0
      or strpos(lower(v.address), lower(p_search)) > 0)
    and (p_after_id is null or (v.visit_date, v.visit_id) > (p_after_date, p_after_id))
  order by v.visit_date, v.visit_id
  limit 1000;
end $$;
revoke all on function public.crm_visit_events_v1(date,date,uuid,text,text,text,date,uuid) from public, anon, authenticated;
grant execute on function public.crm_visit_events_v1(date,date,uuid,text,text,text,date,uuid) to service_role;

notify pgrst, 'reload schema';
commit;
