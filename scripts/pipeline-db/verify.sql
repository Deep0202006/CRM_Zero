do $$
declare
  v jsonb;
  before_tasks bigint;
  before_leads bigint;
begin
  select count(*) into before_leads from public.leads;
  if before_leads <> 4 then raise exception 'fixture lead count drift'; end if;
  if (select count(*) from public.tasks where is_active=false) <> 2 then raise exception 'only proven Pipeline tasks were not archived'; end if;
  if not (select is_active from public.tasks where task_id='30000000-0000-4000-a000-000000000002') then raise exception 'manual task changed'; end if;
  select count(*) into before_tasks from public.tasks;

  v := public.transition_lead_stage_v2('40000000-0000-4000-a000-000000000001','20000000-0000-4000-a000-000000000002','Installation','Converted','10000000-0000-4000-a000-000000000001');
  if not coalesce((v->>'success')::boolean,false) then raise exception 'owner Retailer conversion failed: %',v; end if;
  if (select count(*) from public.tasks) <> before_tasks then raise exception 'transition created task'; end if;

  v := public.transition_lead_stage_v2('40000000-0000-4000-a000-000000000002','20000000-0000-4000-a000-000000000004','Installation','Payment','10000000-0000-4000-a000-000000000003');
  if v->>'code' <> 'PIPELINE_NOT_ASSIGNED' then raise exception 'Admin-not-owner bypassed authority: %',v; end if;
  v := public.transition_lead_stage_v2('40000000-0000-4000-a000-000000000003','20000000-0000-4000-a000-000000000002','Converted','Payment','10000000-0000-4000-a000-000000000001');
  if v->>'code' <> 'PIPELINE_RETAILER_PAYMENT_FORBIDDEN' then raise exception 'Retailer Payment accepted: %',v; end if;
  v := public.transition_lead_stage_v2('40000000-0000-4000-a000-000000000004','20000000-0000-4000-a000-000000000004','Installation','Payment','10000000-0000-4000-a000-000000000002');
  if not coalesce((v->>'success')::boolean,false) then raise exception 'Distributor Payment failed: %',v; end if;
  if public.transition_lead_stage_v2('40000000-0000-4000-a000-000000000004','20000000-0000-4000-a000-000000000004','Installation','Payment','10000000-0000-4000-a000-000000000002')->>'success' <> 'true' then raise exception 'idempotent retry failed'; end if;
  v := public.transition_lead_stage_v2('40000000-0000-4000-a000-000000000005','20000000-0000-4000-a000-000000000003','Payment','Renewal Due','10000000-0000-4000-a000-000000000004');
  if v->>'code' <> 'PIPELINE_ACTOR_INACTIVE' then raise exception 'inactive actor accepted: %',v; end if;
end $$;

-- 038 must correct only the target and retain IDs/counts.
select case when count(*)=4 then 'lead-count-ok' else 'bad' end from public.leads;
select case when count(*)=0 then 'retailer-payment-ok' else 'bad' end from public.leads where segment_type='Retailer' and status='Payment';
select case when count(*)=1 then 'distributor-payment-ok' else 'bad' end from public.leads where segment_type='Distributor' and status='Payment';
select case when count(*)=1 then 'system-audit-ok' else 'bad' end from public.pipeline_transition_operations where event_kind='system_correction' and reason='retailer_payment_stage_removed';

-- Disposable scale fixture: 10,000 rows still return a stable bounded page.
insert into public.leads(lead_id,business_name,contact_person,phone,segment_type,status,assigned_to,created_at)
select ('50000000-0000-4000-a000-' || lpad(i::text,12,'0'))::uuid, 'Scale '||i, 'Person', i::text,
       case when i%2=0 then 'Retailer'::public.segment_type else 'Distributor'::public.segment_type end,
       'New', '10000000-0000-4000-a000-000000000001', now()-(i||' seconds')::interval
from generate_series(1,10000) i;
do $$ begin
  if (select count(*) from (select lead_id from public.leads where segment_type='Retailer' order by created_at desc,lead_id desc limit 50 offset 4950) p) <> 50 then
    raise exception '10k stable bounded page failed';
  end if;
end $$;
