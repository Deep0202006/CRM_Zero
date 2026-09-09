insert into public.users(user_id,name,email,is_active)
select md5('user'||g)::uuid, 'Matching representative '||g, 'rep'||g||'@example.invalid', g<>61 from generate_series(1,61) g;
-- Current capability without a Visit and a non-member must not be conflated.
insert into public.users(user_id,name,email,is_active) values
  (md5('current-only')::uuid,'z'||repeat('😀',1000),'current-only@example.invalid',true),
  (md5('not-field')::uuid,'Not a field representative','not-field@example.invalid',true);
insert into public.capabilities(code,label) values ('field_ret','Synthetic field retailer');
insert into public.user_capabilities(user_id,capability_code) values
  (md5('current-only')::uuid,'field_ret'),(md5('user1')::uuid,'field_ret');
insert into public.leads(lead_id,business_name,contact_person,phone,segment_type)
select md5('lead'||g)::uuid, 'Matching business '||g, 'Contact '||g, '555'||g, 'Retailer'::lead_segment from generate_series(1,61) g;
insert into public.field_visits(visit_id,user_id,lead_id,visit_date,check_in_time,visit_outcome,segment_type,visit_notes,person_met,address)
select md5('visit'||g)::uuid, md5('user'||g)::uuid, (md5('lead'||g)::uuid)::text,
  date '2026-08-01', timestamptz '2026-08-01 04:00:00+00', 'interested', 'Retailer', null, null, null
from generate_series(1,61) g;
insert into public.field_visits(visit_id,user_id,lead_id,visit_date,check_in_time,visit_outcome,segment_type,visit_notes,person_met,address) values
  (md5('legacy')::uuid,md5('user61')::uuid,'not-a-uuid','2026-08-02','2026-08-01 18:29:59+00','legacy-unknown','Retailer','legacy searchable',null,null);
-- More than one full SQL page, with deterministic ties on the business date.
insert into public.field_visits(visit_id,user_id,lead_id,visit_date,check_in_time,visit_outcome,segment_type,visit_notes,person_met,address)
select md5('bulk'||g)::uuid, md5('user1')::uuid, 'legacy-bulk', '2026-08-03', '2026-08-03 04:00:00+00',
  'follow_up','Retailer',null,null,null from generate_series(1,1001) g;

-- Bounded plan-only population, outside the HTTP reconciliation interval.
-- Legacy outcome rows intentionally model pre-constraint retained records.
insert into public.field_visits(visit_id,user_id,lead_id,visit_date,check_in_time,visit_outcome,segment_type,visit_notes,person_met,address)
select md5('plan'||g)::uuid, md5('user'||(1+g%61))::uuid, (md5('lead'||(1+g%61))::uuid)::text,
  date '2026-01-01'+(g%180), timestamptz '2026-01-01 04:00:00+00'+(g%180)*interval '1 day',
  'interested','Retailer',null,null,null from generate_series(1,20000) g;
analyze public.users;
analyze public.leads;
analyze public.field_visits;
