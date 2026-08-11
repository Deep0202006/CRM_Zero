\set ON_ERROR_STOP on
insert into public.users(user_id,name,email,is_active) values
 ('10000000-0000-4000-a000-000000000001','Admin','admin@example.test',true),
 ('20000000-0000-4000-a000-000000000001','Employee One','one@example.test',true),
 ('20000000-0000-4000-a000-000000000002','Employee Two','two@example.test',true),
 ('20000000-0000-4000-a000-000000000003','Inactive Employee','inactive@example.test',false),
 ('20000000-0000-4000-a000-000000000004','My Day Employee','myday@example.test',true);
insert into public.user_capabilities(user_id,capability_code) values ('10000000-0000-4000-a000-000000000001','admin');

set role service_role;

-- Required initial follow-up: NULL/empty/past reject; today/future succeed.
do $$
declare r jsonb; today_text text := (now() at time zone 'Asia/Kolkata')::date::text;
begin
  r:=public.execute_receivable_command_v1('30000000-0000-4000-a000-000000000001','create','10000000-0000-4000-a000-000000000001',repeat('1',64),jsonb_build_object('receivable_id','50000000-0000-4000-a000-000000000001','bill_reference','INV-NULL','distributor_name','Null Followup','distributor_code','','contact_person','A','contact_phone','','bill_amount','1000.00','bill_due_date',today_text,'assigned_to','20000000-0000-4000-a000-000000000001'));
  if r->>'code'<>'INVALID_FOLLOW_UP_DATE' then raise exception 'null follow-up accepted: %',r; end if;
  r:=public.execute_receivable_command_v1('30000000-0000-4000-a000-000000000002','create','10000000-0000-4000-a000-000000000001',repeat('2',64),jsonb_build_object('receivable_id','50000000-0000-4000-a000-000000000002','bill_reference','INV-EMPTY','distributor_name','Empty Followup','distributor_code','','contact_person','A','contact_phone','','bill_amount','1000.00','bill_due_date',today_text,'next_follow_up_date','','assigned_to','20000000-0000-4000-a000-000000000001'));
  if r->>'code'<>'INVALID_FOLLOW_UP_DATE' then raise exception 'empty follow-up accepted: %',r; end if;
  r:=public.execute_receivable_command_v1('30000000-0000-4000-a000-000000000003','create','10000000-0000-4000-a000-000000000001',repeat('3',64),jsonb_build_object('receivable_id','50000000-0000-4000-a000-000000000003','bill_reference','INV-PAST','distributor_name','Past Followup','distributor_code','','contact_person','A','contact_phone','','bill_amount','1000.00','bill_due_date',today_text,'next_follow_up_date',(today_text::date-1)::text,'assigned_to','20000000-0000-4000-a000-000000000001'));
  if r->>'code'<>'INVALID_FOLLOW_UP_DATE' then raise exception 'past follow-up accepted: %',r; end if;
end $$;

select public.execute_receivable_command_v1('30000000-0000-4000-a000-000000000010','create','10000000-0000-4000-a000-000000000001',repeat('a',64),jsonb_build_object('receivable_id','50000000-0000-4000-a000-000000000010','bill_reference','INV-1000','distributor_name','Money Test','distributor_code','MONEY','contact_person','A','contact_phone','','bill_amount','1000.00','bill_due_date',(now() at time zone 'Asia/Kolkata')::date::text,'next_follow_up_date',(now() at time zone 'Asia/Kolkata')::date::text,'assigned_to','20000000-0000-4000-a000-000000000001'));

do $$ declare v record; begin
  select * into v from public.receivables_financial_read_v1 where receivable_id='50000000-0000-4000-a000-000000000010';
  if v.outstanding_amount<>1000.00 or v.payment_state<>'Unpaid' then raise exception 'initial money state wrong'; end if;
end $$;

-- Reported and rejected payments never change confirmed balance.
select public.execute_receivable_command_v1('30000000-0000-4000-a000-000000000011','payment_report','20000000-0000-4000-a000-000000000001',repeat('b',64),jsonb_build_object('receivable_id','50000000-0000-4000-a000-000000000010','expected_version',1,'payment_id','60000000-0000-4000-a000-000000000011','amount','400.00','payment_date',(now() at time zone 'Asia/Kolkata')::date::text));
do $$ begin if (select outstanding_amount from public.receivables_financial_read_v1 where receivable_id='50000000-0000-4000-a000-000000000010')<>1000.00 then raise exception 'reported changed balance'; end if; end $$;
select public.execute_receivable_command_v1('30000000-0000-4000-a000-000000000012','reject_payment','10000000-0000-4000-a000-000000000001',repeat('c',64),jsonb_build_object('receivable_id','50000000-0000-4000-a000-000000000010','expected_version',2,'payment_id','60000000-0000-4000-a000-000000000011','reason','Bank evidence does not match'));
do $$ begin if (select outstanding_amount from public.receivables_financial_read_v1 where receivable_id='50000000-0000-4000-a000-000000000010')<>1000.00 then raise exception 'rejection changed balance'; end if; end $$;

-- Exact NUMERIC partial/full/reversal flow.
select public.execute_receivable_command_v1('30000000-0000-4000-a000-000000000013','direct_payment','10000000-0000-4000-a000-000000000001',repeat('d',64),jsonb_build_object('receivable_id','50000000-0000-4000-a000-000000000010','expected_version',3,'payment_id','60000000-0000-4000-a000-000000000013','amount','400.10','payment_date',(now() at time zone 'Asia/Kolkata')::date::text,'next_follow_up_date',(now() at time zone 'Asia/Kolkata')::date::text));
do $$ declare v record; begin select * into v from public.receivables_financial_read_v1 where receivable_id='50000000-0000-4000-a000-000000000010'; if v.outstanding_amount<>599.90 or v.payment_state<>'Partially Paid' then raise exception 'partial exact money wrong'; end if; end $$;
select public.execute_receivable_command_v1('30000000-0000-4000-a000-000000000014','direct_payment','10000000-0000-4000-a000-000000000001',repeat('e',64),jsonb_build_object('receivable_id','50000000-0000-4000-a000-000000000010','expected_version',4,'payment_id','60000000-0000-4000-a000-000000000014','amount','599.90','payment_date',(now() at time zone 'Asia/Kolkata')::date::text));
do $$ declare v record; begin select * into v from public.receivables_financial_read_v1 where receivable_id='50000000-0000-4000-a000-000000000010'; if v.outstanding_amount<>0.00 or v.payment_state<>'Paid' then raise exception 'paid exact money wrong'; end if; end $$;
do $$ declare r jsonb; begin r:=public.execute_receivable_command_v1('30000000-0000-4000-a000-000000000019','update','10000000-0000-4000-a000-000000000001',repeat('9',64),jsonb_build_object('receivable_id','50000000-0000-4000-a000-000000000010','expected_version',5,'bill_amount','1100.00'));if r->>'code'<>'NEXT_FOLLOW_UP_REQUIRED' then raise exception 'bill increase reopened without follow-up: %',r;end if;end $$;
select public.execute_receivable_command_v1('30000000-0000-4000-a000-000000000015','reverse_payment','10000000-0000-4000-a000-000000000001',repeat('f',64),jsonb_build_object('receivable_id','50000000-0000-4000-a000-000000000010','expected_version',5,'payment_id','60000000-0000-4000-a000-000000000013','reason','Bank reversed settlement'));
do $$ declare v record; begin select * into v from public.receivables_financial_read_v1 where receivable_id='50000000-0000-4000-a000-000000000010'; if v.outstanding_amount<>400.10 or v.payment_state<>'Partially Paid' or v.alert_state='none' then raise exception 'reversal did not reopen'; end if; end $$;

-- Overpayment, zero/negative, future dates, and bill-below-confirmed fail safely.
do $$ declare r jsonb; begin
  r:=public.execute_receivable_command_v1('30000000-0000-4000-a000-000000000016','direct_payment','10000000-0000-4000-a000-000000000001',repeat('0',64),jsonb_build_object('receivable_id','50000000-0000-4000-a000-000000000010','expected_version',6,'payment_id','60000000-0000-4000-a000-000000000016','amount','500.00','payment_date',(now() at time zone 'Asia/Kolkata')::date::text)); if r->>'code'<>'PAYMENT_NOT_ELIGIBLE' then raise exception 'overpayment accepted'; end if;
  r:=public.execute_receivable_command_v1('30000000-0000-4000-a000-000000000017','payment_report','20000000-0000-4000-a000-000000000001',repeat('1',64),jsonb_build_object('receivable_id','50000000-0000-4000-a000-000000000010','expected_version',6,'payment_id','60000000-0000-4000-a000-000000000017','amount','1.00','payment_date',((now() at time zone 'Asia/Kolkata')::date+1)::text)); if r->>'code'<>'FUTURE_PAYMENT_DATE' then raise exception 'future payment accepted'; end if;
  r:=public.execute_receivable_command_v1('30000000-0000-4000-a000-000000000018','update','10000000-0000-4000-a000-000000000001',repeat('2',64),jsonb_build_object('receivable_id','50000000-0000-4000-a000-000000000010','expected_version',6,'bill_amount','500.00')); if r->>'code'<>'BILL_BELOW_CONFIRMED' then raise exception 'bill reduced below confirmed'; end if;
end $$;
do $$ begin
  begin insert into public.receivable_payments(payment_id,receivable_id,amount,payment_date,reported_by,verification_status) values(gen_random_uuid(),'50000000-0000-4000-a000-000000000010',0,current_date,'10000000-0000-4000-a000-000000000001','reported'); raise exception 'zero accepted'; exception when check_violation then null; end;
  begin insert into public.receivable_payments(payment_id,receivable_id,amount,payment_date,reported_by,verification_status) values(gen_random_uuid(),'50000000-0000-4000-a000-000000000010',-1,current_date,'10000000-0000-4000-a000-000000000001','reported'); raise exception 'negative accepted'; exception when check_violation then null; end;
end $$;

-- Idempotency and stale version.
do $$ declare a jsonb; b jsonb; c jsonb; begin
  a:=public.execute_receivable_command_v1('30000000-0000-4000-a000-000000000020','contacted','20000000-0000-4000-a000-000000000001',repeat('3',64),jsonb_build_object('receivable_id','50000000-0000-4000-a000-000000000010','expected_version',6,'next_follow_up_date',(now() at time zone 'Asia/Kolkata')::date::text));
  b:=public.execute_receivable_command_v1('30000000-0000-4000-a000-000000000020','contacted','20000000-0000-4000-a000-000000000001',repeat('3',64),jsonb_build_object('receivable_id','50000000-0000-4000-a000-000000000010','expected_version',6,'next_follow_up_date',(now() at time zone 'Asia/Kolkata')::date::text));
  if a<>b or (select count(*) from public.receivable_activity_events where receivable_id='50000000-0000-4000-a000-000000000010' and event_type='followup_contacted')<>1 then raise exception 'retry duplicated'; end if;
  c:=public.execute_receivable_command_v1('30000000-0000-4000-a000-000000000020','contacted','20000000-0000-4000-a000-000000000001',repeat('4',64),jsonb_build_object('receivable_id','50000000-0000-4000-a000-000000000010','expected_version',6,'next_follow_up_date',(now() at time zone 'Asia/Kolkata')::date::text)); if c->>'code'<>'RECEIVABLE_OPERATION_MISMATCH' then raise exception 'changed retry accepted'; end if;
  c:=public.execute_receivable_command_v1('30000000-0000-4000-a000-000000000021','contacted','20000000-0000-4000-a000-000000000001',repeat('5',64),jsonb_build_object('receivable_id','50000000-0000-4000-a000-000000000010','expected_version',6,'next_follow_up_date',(now() at time zone 'Asia/Kolkata')::date::text)); if c->>'code'<>'RECEIVABLE_CONFLICT' then raise exception 'stale version accepted'; end if;
end $$;

-- Reassignment checks active state and stale employee replay.
do $$ declare r jsonb; begin
  r:=public.execute_receivable_command_v1('30000000-0000-4000-a000-000000000022','reassign','10000000-0000-4000-a000-000000000001',repeat('6',64),jsonb_build_object('receivable_id','50000000-0000-4000-a000-000000000010','expected_version',7,'assigned_to','20000000-0000-4000-a000-000000000003')); if r->>'code'<>'ASSIGNEE_INACTIVE' then raise exception 'inactive reassignment accepted'; end if;
  r:=public.execute_receivable_command_v1('30000000-0000-4000-a000-000000000023','reassign','10000000-0000-4000-a000-000000000001',repeat('7',64),jsonb_build_object('receivable_id','50000000-0000-4000-a000-000000000010','expected_version',7,'assigned_to','20000000-0000-4000-a000-000000000002')); if not (r->>'success')::boolean then raise exception 'valid reassignment failed'; end if;
  r:=public.execute_receivable_command_v1('30000000-0000-4000-a000-000000000024','contacted','20000000-0000-4000-a000-000000000001',repeat('8',64),jsonb_build_object('receivable_id','50000000-0000-4000-a000-000000000010','expected_version',7,'next_follow_up_date',(now() at time zone 'Asia/Kolkata')::date::text)); if r->>'code' not in ('RECEIVABLE_CONFLICT','RECEIVABLE_NOT_ASSIGNED') then raise exception 'old employee replay accepted'; end if;
end $$;

-- Reason constraints reject NULL structurally.
do $$ begin
  begin update public.receivable_payments set verification_status='rejected',verified_by='10000000-0000-4000-a000-000000000001',verified_at=now(),rejection_reason=null where payment_id='60000000-0000-4000-a000-000000000011'; raise exception 'null rejection reason accepted'; exception when check_violation then null; end;
end $$;

-- Import validation-first atomicity: row 3 conflict and row 101 conflict create zero persistent rows/batches/events.
insert into public.receivables(receivable_id,bill_reference,bill_reference_key,distributor_name,distributor_identity_key,contact_person,bill_amount,bill_due_date,next_follow_up_date,assigned_to,source,created_by)
values('50000000-0000-4000-a000-000000000099','CONFLICT','conflict','Existing','name:existing','A',10.00,current_date,current_date,'20000000-0000-4000-a000-000000000001','manual','10000000-0000-4000-a000-000000000001');
do $$ declare before_r int;before_b int;before_e int;r jsonb;rows jsonb; begin
  select count(*) into before_r from public.receivables;select count(*) into before_b from public.receivable_import_batches;select count(*) into before_e from public.receivable_activity_events;
  rows:=jsonb_build_array(
   jsonb_build_object('row_number',2,'receivable_id',gen_random_uuid(),'bill_reference','NEW-1','distributor_name','New One','distributor_code','','contact_person','A','contact_phone','','bill_amount','20.00','bill_due_date',current_date,'next_follow_up_date',current_date,'assigned_to','20000000-0000-4000-a000-000000000001','notes',''),
   jsonb_build_object('row_number',3,'receivable_id',gen_random_uuid(),'bill_reference','NEW-2','distributor_name','New Two','distributor_code','','contact_person','A','contact_phone','','bill_amount','20.00','bill_due_date',current_date,'next_follow_up_date',current_date,'assigned_to','20000000-0000-4000-a000-000000000001','notes',''),
   jsonb_build_object('row_number',4,'receivable_id',gen_random_uuid(),'bill_reference',' conflict ','distributor_name','EXISTING','distributor_code','','contact_person','A','contact_phone','','bill_amount','99.00','bill_due_date',current_date,'next_follow_up_date',current_date,'assigned_to','20000000-0000-4000-a000-000000000001','notes',''));
  r:=public.import_receivables_v1('40000000-0000-4000-a000-000000000001','10000000-0000-4000-a000-000000000001',repeat('9',64),'late-conflict.xlsx',repeat('a',64),rows);
  if r->>'code'<>'IMPORT_REFRESH_REQUIRED' or (select count(*) from public.receivables)<>before_r or (select count(*) from public.receivable_import_batches)<>before_b or (select count(*) from public.receivable_activity_events)<>before_e then raise exception '3-row import was partial: %',r; end if;
  select jsonb_agg(case when n=101 then jsonb_build_object('row_number',n+1,'receivable_id',gen_random_uuid(),'bill_reference','CONFLICT','distributor_name','Existing','distributor_code','','contact_person','A','contact_phone','','bill_amount','99.00','bill_due_date',current_date,'next_follow_up_date',current_date,'assigned_to','20000000-0000-4000-a000-000000000001','notes','') else jsonb_build_object('row_number',n+1,'receivable_id',gen_random_uuid(),'bill_reference','BULK-'||n,'distributor_name','Bulk '||n,'distributor_code','','contact_person','A','contact_phone','','bill_amount','20.00','bill_due_date',current_date,'next_follow_up_date',current_date,'assigned_to','20000000-0000-4000-a000-000000000001','notes','') end order by n) into rows from generate_series(1,101)n;
  r:=public.import_receivables_v1('40000000-0000-4000-a000-000000000002','10000000-0000-4000-a000-000000000001',repeat('b',64),'101-conflict.xlsx',repeat('b',64),rows);
  if r->>'code'<>'IMPORT_REFRESH_REQUIRED' or (select count(*) from public.receivables)<>before_r or (select count(*) from public.receivable_import_batches)<>before_b or (select count(*) from public.receivable_activity_events)<>before_e then raise exception '101-row import was partial: %',r; end if;
end $$;

-- Inactive employee anywhere in import creates zero writes.
do $$ declare before_r int;before_b int;before_e int;r jsonb;rows jsonb; begin
 select count(*) into before_r from public.receivables;select count(*) into before_b from public.receivable_import_batches;select count(*) into before_e from public.receivable_activity_events;
 rows:=jsonb_build_array(jsonb_build_object('row_number',2,'receivable_id',gen_random_uuid(),'bill_reference','INACTIVE-1','distributor_name','Inactive Import','distributor_code','','contact_person','A','contact_phone','','bill_amount','20.00','bill_due_date',current_date,'next_follow_up_date',current_date,'assigned_to','20000000-0000-4000-a000-000000000003','notes',''));
 r:=public.import_receivables_v1('40000000-0000-4000-a000-000000000003','10000000-0000-4000-a000-000000000001',repeat('c',64),'inactive.xlsx',repeat('c',64),rows);
 if r->>'code'<>'IMPORT_EMPLOYEE_CHANGED' or (select count(*) from public.receivables)<>before_r or (select count(*) from public.receivable_import_batches)<>before_b or (select count(*) from public.receivable_activity_events)<>before_e then raise exception 'inactive import wrote'; end if;
end $$;

-- Successful import and renamed exact replay do not duplicate.
do $$ declare a jsonb;b jsonb;rows jsonb;before_r int; begin
 rows:=jsonb_build_array(jsonb_build_object('row_number',2,'receivable_id','50000000-0000-4000-a000-000000000080','bill_reference','IMPORT-OK','distributor_name','Unicode वितरण','distributor_code','IMP','contact_person','A','contact_phone','','bill_amount','84.50','bill_due_date',current_date,'next_follow_up_date',current_date,'assigned_to','20000000-0000-4000-a000-000000000001','notes',''));
 a:=public.import_receivables_v1('40000000-0000-4000-a000-000000000004','10000000-0000-4000-a000-000000000001',repeat('d',64),'first.xlsx',repeat('d',64),rows);select count(*) into before_r from public.receivables;
 b:=public.import_receivables_v1('40000000-0000-4000-a000-000000000005','10000000-0000-4000-a000-000000000001',repeat('e',64),'renamed.xlsx',repeat('d',64),rows);
 if not (a->>'success')::boolean or not (b->>'success')::boolean or (select count(*) from public.receivables)<>before_r or b->>'replayed_batch'<>'true' then raise exception 'exact import replay duplicated'; end if;
end $$;

-- My Day aggregates all 12 urgent rows while returning five.
insert into public.receivables(receivable_id,bill_reference,bill_reference_key,distributor_name,distributor_identity_key,contact_person,bill_amount,bill_due_date,next_follow_up_date,assigned_to,source,created_by)
select gen_random_uuid(),'URG-'||n,'urg-'||n,'Urgent '||n,'name:urgent-'||n,'A',100.00,current_date-10,current_date-1,'20000000-0000-4000-a000-000000000004','manual','10000000-0000-4000-a000-000000000001' from generate_series(1,12)n;
do $$ declare r jsonb; begin r:=public.receivables_my_day_v1('20000000-0000-4000-a000-000000000004'); if (r->>'urgentCount')::int<>12 or jsonb_array_length(r->'rows')<>5 or (r->>'outstandingAmount')::numeric<>1200.00 then raise exception 'My Day total wrong: %',r; end if; end $$;

-- Admin metrics: cancelled excluded everywhere; disputed included in outstanding/aging; payment_date owns month.
insert into public.receivables(receivable_id,bill_reference,bill_reference_key,distributor_name,distributor_identity_key,contact_person,bill_amount,bill_due_date,next_follow_up_date,assigned_to,lifecycle_status,source,created_by,cancelled_at,cancelled_by,cancellation_reason)
values('50000000-0000-4000-a000-000000000090','CANCEL','cancel','Cancelled','name:cancelled','A',500.00,current_date-40,null,'20000000-0000-4000-a000-000000000001','cancelled','manual','10000000-0000-4000-a000-000000000001',now(),'10000000-0000-4000-a000-000000000001','Duplicate invoice'),
('50000000-0000-4000-a000-000000000091','DISPUTE','dispute','Disputed','name:disputed','A',300.00,current_date-40,current_date,'20000000-0000-4000-a000-000000000001','disputed','manual','10000000-0000-4000-a000-000000000001',null,null,null);
insert into public.receivable_payments(payment_id,receivable_id,amount,payment_date,reported_by,verification_status,verified_by,verified_at) values
('60000000-0000-4000-a000-000000000090','50000000-0000-4000-a000-000000000091',10.00,date_trunc('month',(now() at time zone 'Asia/Kolkata'))::date-1,'10000000-0000-4000-a000-000000000001','confirmed','10000000-0000-4000-a000-000000000001',now()),
('60000000-0000-4000-a000-000000000091','50000000-0000-4000-a000-000000000091',20.00,date_trunc('month',(now() at time zone 'Asia/Kolkata'))::date,'10000000-0000-4000-a000-000000000001','confirmed','10000000-0000-4000-a000-000000000001',now()-interval '20 days');
do $$ declare r jsonb;total_aging numeric; begin r:=public.receivables_admin_metrics_v1('10000000-0000-4000-a000-000000000001');select sum(value::text::numeric) into total_aging from jsonb_each(r->'aging');if (r->>'collected_this_month')::numeric<>20.00 or (r->>'disputed_outstanding')::numeric<>270.00 or total_aging<>(r->>'total_outstanding')::numeric then raise exception 'Admin metrics inconsistent: %',r;end if;end $$;

-- RLS and service-only authority.
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub','20000000-0000-4000-a000-000000000001',false);
do $$ begin if exists(select 1 from public.receivables where assigned_to<>'20000000-0000-4000-a000-000000000001') then raise exception 'employee RLS leaked'; end if; end $$;
select set_config('request.jwt.claim.sub','20000000-0000-4000-a000-000000000002',false);
do $$ begin if exists(select 1 from public.receivables where assigned_to='20000000-0000-4000-a000-000000000001') then raise exception 'unrelated employee RLS leaked'; end if; end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-a000-000000000001',false);
do $$ begin if (select count(*) from public.receivables)=0 then raise exception 'Admin cannot read'; end if; end $$;
do $$ begin
 begin insert into public.receivables(receivable_id,bill_reference,bill_reference_key,distributor_name,distributor_identity_key,contact_person,bill_amount,bill_due_date,assigned_to,source,created_by) values(gen_random_uuid(),'X','x','X','x','X',1,current_date,'20000000-0000-4000-a000-000000000001','manual','10000000-0000-4000-a000-000000000001');raise exception 'browser insert allowed';exception when insufficient_privilege then null;end;
 begin update public.receivables set contact_person='Forged';raise exception 'browser update allowed';exception when insufficient_privilege then null;end;
 begin delete from public.receivables;raise exception 'browser delete allowed';exception when insufficient_privilege then null;end;
 begin perform public.execute_receivable_command_v1(gen_random_uuid(),'cancel','10000000-0000-4000-a000-000000000001',repeat('f',64),'{}');raise exception 'authenticated RPC allowed';exception when insufficient_privilege then null;end;
end $$;
reset role;

-- Seed isolated concurrency target for shell-level parallel calls.
insert into public.receivables(receivable_id,bill_reference,bill_reference_key,distributor_name,distributor_identity_key,contact_person,bill_amount,bill_due_date,next_follow_up_date,assigned_to,source,created_by)
values('50000000-0000-4000-a000-000000000007','RACE','race','Race','name:race','A',1000.00,current_date,current_date,'20000000-0000-4000-a000-000000000001','manual','10000000-0000-4000-a000-000000000001');

select 'receivables integration assertions passed' as result;
