insert into public.users(user_id,name,email,is_active)
select md5('user'||g)::uuid, 'Matching representative '||g, 'rep'||g||'@example.invalid', g<>61 from generate_series(1,61) g;
-- Current capability without a Visit and a non-member must not be conflated.
insert into public.users(user_id,name,email,is_active) values
  (md5('current-only')::uuid,'z'||repeat('😀',1000),'current-only@example.invalid',true),
  (md5('not-field')::uuid,'Not a field representative','not-field@example.invalid',true);
insert into public.capabilities(code,label) values ('field_ret','Synthetic field retailer');
insert into public.capabilities(code,label) values ('admin','Synthetic fixture admin');
insert into public.user_capabilities(user_id,capability_code) values (md5('user1')::uuid,'admin');
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
insert into public.erp_systems(erp_id,erp_name,erp_key,created_by) values (md5('erp')::uuid,'Synthetic ERP','synthetic erp',md5('user1')::uuid);
update public.field_visits set erp_usage_state='erp',erp_id=md5('erp')::uuid,visit_notes='Literal %_,(). exact' where visit_id=md5('bulk1')::uuid;
update public.field_visits set erp_usage_state='none' where visit_id=md5('legacy')::uuid;
update public.field_visits set erp_usage_state='erp',erp_id=md5('erp')::uuid where visit_id=md5('visit61')::uuid;
-- Pipeline adversaries: filters must run before the old500/2000/100 caps.
insert into public.leads(lead_id,business_name,contact_person,phone,segment_type,status,assigned_to,created_at,stage_entered_at,lead_source,area)
select md5('pipeline'||g)::uuid,'Pipeline fixture '||g,'Person','555000','Retailer',
  (case when g%2=0 then 'New' else 'Contacted' end)::lead_status,md5('user1')::uuid,
  '2020-01-01','2020-01-01','Referral',case when g=2 then 'Neighbor exact scope' else 'Literal %_,().' end from generate_series(1,600) g;
insert into public.leads(lead_id,business_name,contact_person,phone,segment_type,created_at)
values(md5('pipeline-other')::uuid,'Other segment fixture','Person','555001','Distributor','2020-01-01');
insert into public.tasks(task_id,assigned_to,title,priority,status,source,related_lead_id,due_date)
select md5('pipeline-task'||g)::uuid,md5('user1')::uuid,'Exact open task '||g,'High','Pending','manual',md5('pipeline'||g)::uuid,'2026-08-01' from generate_series(1,600) g;
insert into public.tasks(task_id,assigned_to,title,priority,status,source,related_lead_id,due_date)
select md5('busy-task'||g)::uuid,md5('user1')::uuid,'Busy lead task '||g,'Medium','Pending','manual',md5('pipeline1')::uuid,'2026-08-02' from generate_series(1,120) g;
insert into public.tasks(task_id,assigned_to,title,priority,status,source,related_lead_id,due_date)
select md5('terminal-task'||g)::uuid,md5('user1')::uuid,'Terminal task '||g,'Medium','Completed','manual',md5('pipeline2')::uuid,'2020-01-01' from generate_series(1,25) g;
insert into public.call_logs(log_id,user_id,lead_id,timestamp,outcome)
select md5('busy-call'||g)::uuid,md5('user1')::uuid,md5('pipeline1')::uuid,'2026-09-08 04:00+00','Contacted' from generate_series(1,120) g;
insert into public.call_logs(log_id,user_id,lead_id,timestamp,outcome)
values(md5('neighbor-call')::uuid,md5('user2')::uuid,md5('pipeline2')::uuid,'2026-09-07 04:00+00','Contacted');
insert into public.pipeline_transition_operations(operation_id,lead_id,actor_id,expected_stage,target_stage,confirmed_at)
select md5('pipeline-transition'||g)::uuid,md5('pipeline'||g)::uuid,md5('user1')::uuid,'New','Contacted','2026-09-08 04:00+00' from generate_series(1,600) g;
insert into public.pipeline_transition_operations(operation_id,lead_id,actor_id,expected_stage,target_stage,confirmed_at)
select md5('other-transition'||g)::uuid,md5('pipeline-other')::uuid,md5('user1')::uuid,'New','Contacted','2026-09-08 05:00+00' from generate_series(1,2200) g;
analyze public.tasks;
analyze public.call_logs;
analyze public.pipeline_transition_operations;
analyze public.users;
analyze public.leads;
analyze public.field_visits;
