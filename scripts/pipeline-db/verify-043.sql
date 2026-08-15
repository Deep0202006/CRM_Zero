do $$
declare
  v jsonb;
  v_leads bigint := (select count(*) from public.leads);
  v_tasks bigint := (select count(*) from public.tasks);
  v_calls bigint := (select count(*) from public.call_logs);
  v_attendance bigint := (select count(*) from public.attendance);
  v_visits bigint := (select count(*) from public.field_visits);
  v_receivables bigint := (select count(*) from public.receivables);
  v_payments bigint := (select count(*) from public.receivable_payments);
  v_distributors bigint := (select count(*) from public.distributor_accounts);
  v_chat bigint := (select count(*) from public.chat_messages);
  v_started timestamptz;
begin
  v := public.pipeline_create_lead_v1(
    '82000000-0000-4000-a000-000000000001','83000000-0000-4000-a000-000000000001','10000000-0000-4000-a000-000000000001',
    'Canonical New Business','Owner','9876543299','Retailer','Cold Call','Anand',now()
  );
  if v->>'code' <> 'LEAD_CREATED' or (select count(*) from public.leads) <> v_leads + 1 then raise exception 'canonical create failed: %',v; end if;
  if public.pipeline_create_lead_v1(
    '82000000-0000-4000-a000-000000000001','83000000-0000-4000-a000-000000000001','10000000-0000-4000-a000-000000000001',
    'Canonical New Business','Owner','9876543299','Retailer','Cold Call','Anand',(v->'lead'->>'created_at')::timestamptz
  )->>'code' <> 'LEAD_ALREADY_CONFIRMED' then raise exception 'lost-response replay was not idempotent'; end if;

  v := public.pipeline_create_lead_v1(
    '82000000-0000-4000-a000-000000000002','83000000-0000-4000-a000-000000000002','10000000-0000-4000-a000-000000000002',
    'POOJA MEDICAL& PROV STORES','Other','987-654-3210','Retailer','Referral','ANAND',now()
  );
  if v->>'code' <> 'LEAD_ALREADY_EXISTS' or v->'existing'->>'status' <> 'Converted' then raise exception 'Converted duplicate was not blocked: %',v; end if;

  v := public.pipeline_create_lead_v1(
    '82000000-0000-4000-a000-000000000003','83000000-0000-4000-a000-000000000003','10000000-0000-4000-a000-000000000002',
    'New Identity Medical','Other','9876543211','Retailer','Referral','Anand',now()
  );
  if v->>'code' <> 'LEAD_ALREADY_EXISTS' or v->'existing'->>'status' <> 'New' then raise exception 'New duplicate was not blocked: %',v; end if;

  v := public.pipeline_create_lead_v1(
    '82000000-0000-4000-a000-000000000004','83000000-0000-4000-a000-000000000004','10000000-0000-4000-a000-000000000002',
    'Contacted Identity Medical','Other','9876543212','Retailer','Referral','Anand',now()
  );
  if v->>'code' <> 'LEAD_ALREADY_EXISTS' or v->'existing'->>'status' <> 'Contacted' then raise exception 'Contacted duplicate was not blocked: %',v; end if;

  v := public.pipeline_create_lead_v1(
    '82000000-0000-4000-a000-000000000005','83000000-0000-4000-a000-000000000005','10000000-0000-4000-a000-000000000002',
    'Pooja Medical Wholesale','Other','9876543288','Retailer','Referral','Anand',now()
  );
  if v->>'code' <> 'LEAD_CREATED' then raise exception 'legitimately different business was blocked: %',v; end if;

  if (select count(*) from public.tasks) <> v_tasks then raise exception 'Lead creation wrote Tasks'; end if;
  if (select count(*) from public.call_logs) <> v_calls then raise exception 'Lead creation wrote Calls'; end if;
  if (select count(*) from public.attendance) <> v_attendance then raise exception 'Lead creation wrote Attendance'; end if;
  if (select count(*) from public.field_visits) <> v_visits then raise exception 'Lead creation wrote Field Visits'; end if;
  if (select count(*) from public.receivables) <> v_receivables then raise exception 'Lead creation wrote Receivables'; end if;
  if (select count(*) from public.receivable_payments) <> v_payments then raise exception 'Lead creation wrote Payments'; end if;
  if (select count(*) from public.distributor_accounts) <> v_distributors then raise exception 'Lead creation wrote Distributor Status'; end if;
  if (select count(*) from public.chat_messages) <> v_chat then raise exception 'Lead creation wrote Chat'; end if;
  if (select count(*) from public.pipeline_create_operations where origin <> 'pipeline_create_lead_v1') <> 0 then raise exception 'creation origin drift'; end if;

  v_started := clock_timestamp();
  perform 1 from public.leads l
  where public.pipeline_normalize_identity_text(l.business_name)='scale9999'
    and public.pipeline_normalize_phone(l.phone)='9999'
  limit 1;
  if clock_timestamp() - v_started > interval '500 milliseconds' then raise exception '10k duplicate lookup exceeded 500ms'; end if;
end $$;

do $$ begin
  begin
    insert into public.leads(lead_id,business_name,contact_person,phone,segment_type,status,assigned_to)
    values('83000000-0000-4000-a000-000000000006','Forbidden','Person','9876543277','Retailer','New','10000000-0000-4000-a000-000000000001');
    raise exception 'direct Lead insert bypassed creation firewall';
  exception when insufficient_privilege then null;
  end;
end $$;

begin;
select set_config('zerodata.expected_leads',(select count(*)::text from public.leads),true);
set local request.jwt.claim.sub = '10000000-0000-4000-a000-000000000001';
set local role authenticated;
do $$ begin if (select count(*) from public.leads) <> current_setting('zerodata.expected_leads')::bigint then raise exception 'employee A visibility mismatch'; end if; end $$;
rollback;

begin;
select set_config('zerodata.expected_leads',(select count(*)::text from public.leads),true);
set local request.jwt.claim.sub = '10000000-0000-4000-a000-000000000002';
set local role authenticated;
do $$ begin if (select count(*) from public.leads) <> current_setting('zerodata.expected_leads')::bigint then raise exception 'employee B visibility mismatch'; end if; end $$;
rollback;

begin;
select set_config('zerodata.expected_leads',(select count(*)::text from public.leads),true);
set local request.jwt.claim.sub = '10000000-0000-4000-a000-000000000003';
set local role authenticated;
do $$ begin if (select count(*) from public.leads) <> current_setting('zerodata.expected_leads')::bigint then raise exception 'admin visibility mismatch'; end if; end $$;
rollback;

begin;
set local request.jwt.claim.sub = '10000000-0000-4000-a000-000000000004';
set local role authenticated;
do $$ begin if (select count(*) from public.leads) <> 0 then raise exception 'inactive user read Pipeline'; end if; end $$;
rollback;

select case when count(*)=2 then 'create-count-ok' else 'bad' end from public.pipeline_create_operations;
select case when count(*)=1 then 'pooja-history-ok' else 'bad' end from public.leads where public.pipeline_normalize_identity_text(business_name)='poojamedicalprovstores';

explain (analyze, buffers, format text)
select lead_id,business_name,contact_person,phone,segment_type,status,assigned_to,created_at,stage_entered_at,onboarded_at,lead_source,area
from public.leads where segment_type='Retailer' order by created_at desc,lead_id desc limit 50;

explain (analyze, buffers, format text)
select lead_id from public.leads where segment_type='Retailer' and status='New' order by created_at desc,lead_id desc limit 50;

explain (analyze, buffers, format text)
select lead_id from public.leads l
where public.pipeline_normalize_identity_text(l.business_name)='poojamedicalprovstores'
  and public.pipeline_normalize_phone(l.phone)='9876543210'
limit 1;

explain (analyze, buffers, format text)
select public.pipeline_create_lead_v1(
  '82000000-0000-4000-a000-000000000006','83000000-0000-4000-a000-000000000007','10000000-0000-4000-a000-000000000001',
  'POOJA MEDICAL & PROV STORES','Pooja','9876543210','Retailer','Cold Call','Anand',now()
);
