do $$
declare
  v jsonb;
  before_tasks bigint;
begin
  if (select count(*) from public.leads) <> 5 then raise exception 'fixture lead count drift'; end if;
  if (select count(*) from public.tasks where is_active=false) <> 2 then raise exception 'only proven Pipeline tasks were not archived'; end if;
  if not (select is_active from public.tasks where task_id='30000000-0000-4000-a000-000000000002') then raise exception 'manual task changed'; end if;
  select count(*) into before_tasks from public.tasks;

  if public.process_renewals(current_date) <> 1 then raise exception 'Distributor renewal did not transition exactly once'; end if;
  if public.process_renewals(current_date) <> 0 then raise exception 'Distributor renewal was not idempotent'; end if;
  if (select status::text from public.leads where lead_id='20000000-0000-4000-a000-000000000003') <> 'Renewal Due' then raise exception 'Distributor Payment did not become Renewal Due'; end if;
  if (select count(*) from public.tasks) <> before_tasks then raise exception 'renewal processor created task'; end if;
  if (select count(*) from public.pipeline_transition_operations where lead_id='20000000-0000-4000-a000-000000000003' and actor_id is null and expected_stage='Payment' and target_stage='Renewal Due' and event_kind='system_correction' and reason='distributor_renewal_due') <> 1 then raise exception 'renewal audit missing'; end if;

  v := public.transition_lead_stage_v2('40000000-0000-4000-a000-000000000010','20000000-0000-4000-a000-000000000003','Renewal Due','Payment','10000000-0000-4000-a000-000000000001');
  if not coalesce((v->>'success')::boolean,false) then raise exception 'Distributor Renewal Due to Payment failed: %',v; end if;

  v := public.transition_lead_stage_v2('40000000-0000-4000-a000-000000000011','20000000-0000-4000-a000-000000000005','Contacted','Not Interested','10000000-0000-4000-a000-000000000001');
  if not coalesce((v->>'success')::boolean,false) then raise exception 'Contacted to Not Interested failed: %',v; end if;
  if (select count(*) from public.pipeline_transition_operations where operation_id='40000000-0000-4000-a000-000000000011' and expected_stage='Contacted' and target_stage='Not Interested' and event_kind='user_transition' and actor_id='10000000-0000-4000-a000-000000000001' and reason is null) <> 1 then raise exception 'Not Interested audit violates contract'; end if;

  v := public.transition_lead_stage_v2('40000000-0000-4000-a000-000000000012','20000000-0000-4000-a000-000000000005','Not Interested','Contacted','10000000-0000-4000-a000-000000000001');
  if not coalesce((v->>'success')::boolean,false) then raise exception 'Not Interested to Contacted failed: %',v; end if;
  if (select count(*) from public.tasks) <> before_tasks then raise exception 'Pipeline transition created task'; end if;
end $$;

-- Existing active roles retain lead intake; owner forgery and direct stage writes fail under RLS/guard.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-a000-000000000001';
do $$
begin
  if (select count(*) from public.leads) <> 5 then raise exception 'active owner cannot read global Pipeline'; end if;
  insert into public.leads(lead_id,business_name,contact_person,phone,segment_type,status,assigned_to)
  values('21000000-0000-4000-a000-000000000001','Disposable Intake','Person','6','Retailer','New','10000000-0000-4000-a000-000000000001');
  begin
    insert into public.leads(lead_id,business_name,contact_person,phone,segment_type,status,assigned_to)
    values('21000000-0000-4000-a000-000000000002','Forged Intake','Person','7','Retailer','New','10000000-0000-4000-a000-000000000002');
    raise exception 'forged owner intake was accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.leads set status='Interested' where lead_id='20000000-0000-4000-a000-000000000005';
    raise exception 'direct browser stage write was accepted';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;

-- Admin is a global reader but has no ordinary mutation override when not assigned.
begin;
set local role authenticated;
set local request.jwt.claim.sub = '10000000-0000-4000-a000-000000000003';
do $$
begin
  if (select count(*) from public.leads) <> 5 then raise exception 'active Admin cannot read global Pipeline'; end if;
  update public.leads set business_name='Forbidden Admin Edit' where lead_id='20000000-0000-4000-a000-000000000001';
  if found then raise exception 'Admin-not-owner business edit was accepted'; end if;
end $$;
rollback;
