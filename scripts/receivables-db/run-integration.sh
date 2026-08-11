#!/usr/bin/env bash
set -euo pipefail

production_ref="gwfjkpsoaoherntwhdyf"
connection_fingerprint="${PGHOST:-} ${PGDATABASE:-} ${DATABASE_URL:-} ${SUPABASE_URL:-} ${NEXT_PUBLIC_SUPABASE_URL:-}"
if [[ "$connection_fingerprint" == *"$production_ref"* ]] || [[ "${PGHOST:-}" == *.supabase.co ]]; then
  echo "Refusing to run Receivables fixtures against a production Supabase target." >&2
  exit 86
fi

psql -v ON_ERROR_STOP=1 -f scripts/receivables-db/fixture.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/033_receivables_v1.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/034_receivables_production_completion.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/035_receivables_import_linearization.sql
psql -v ON_ERROR_STOP=1 -f scripts/receivables-db/integration.sql

# Two concurrent Admin direct-payment commands both start at version 1. One may
# succeed; the other must observe the locked row at version 2 and conflict.
command_a="set role service_role; select public.execute_receivable_command_v1('70000000-0000-4000-a000-000000000001','direct_payment','10000000-0000-4000-a000-000000000001',repeat('7',64),jsonb_build_object('receivable_id','50000000-0000-4000-a000-000000000007','expected_version',1,'payment_id','60000000-0000-4000-a000-000000000071','amount','600.00','payment_date',(now() at time zone 'Asia/Kolkata')::date::text,'next_follow_up_date',(now() at time zone 'Asia/Kolkata')::date::text));"
command_b="set role service_role; select public.execute_receivable_command_v1('70000000-0000-4000-a000-000000000002','direct_payment','10000000-0000-4000-a000-000000000001',repeat('8',64),jsonb_build_object('receivable_id','50000000-0000-4000-a000-000000000007','expected_version',1,'payment_id','60000000-0000-4000-a000-000000000072','amount','600.00','payment_date',(now() at time zone 'Asia/Kolkata')::date::text,'next_follow_up_date',(now() at time zone 'Asia/Kolkata')::date::text));"
psql -v ON_ERROR_STOP=1 -Atc "$command_a" > /tmp/receivables-command-a.out & pid_a=$!
psql -v ON_ERROR_STOP=1 -Atc "$command_b" > /tmp/receivables-command-b.out & pid_b=$!
wait "$pid_a"; wait "$pid_b"
combined="$(cat /tmp/receivables-command-a.out /tmp/receivables-command-b.out)"
grep -q '"success": true' <<< "$combined"
grep -q 'RECEIVABLE_CONFLICT' <<< "$combined"
psql -v ON_ERROR_STOP=1 -Atc "select case when count(*)=1 and sum(amount)=600.00 then 'ok' else 'bad' end from public.receivable_payments where receivable_id='50000000-0000-4000-a000-000000000007' and verification_status='confirmed';" | grep -q '^ok$'

# Two devices confirm the same employee-reported payment. Exactly one transition
# and one confirmation event may commit; the other command sees a stale version.
confirm_a="set role service_role; select public.execute_receivable_command_v1('70000000-0000-4000-a000-000000000011','confirm_payment','10000000-0000-4000-a000-000000000001',repeat('a',64),jsonb_build_object('receivable_id','50000000-0000-4000-a000-000000000008','expected_version',1,'payment_id','60000000-0000-4000-a000-000000000080','next_follow_up_date',(now() at time zone 'Asia/Kolkata')::date::text));"
confirm_b="set role service_role; select public.execute_receivable_command_v1('70000000-0000-4000-a000-000000000012','confirm_payment','10000000-0000-4000-a000-000000000001',repeat('b',64),jsonb_build_object('receivable_id','50000000-0000-4000-a000-000000000008','expected_version',1,'payment_id','60000000-0000-4000-a000-000000000080','next_follow_up_date',(now() at time zone 'Asia/Kolkata')::date::text));"
psql -v ON_ERROR_STOP=1 -Atc "$confirm_a" > /tmp/receivables-confirm-a.out & confirm_pid_a=$!
psql -v ON_ERROR_STOP=1 -Atc "$confirm_b" > /tmp/receivables-confirm-b.out & confirm_pid_b=$!
wait "$confirm_pid_a"; wait "$confirm_pid_b"
confirm_combined="$(cat /tmp/receivables-confirm-a.out /tmp/receivables-confirm-b.out)"
grep -q '"success": true' <<< "$confirm_combined"
grep -q 'RECEIVABLE_CONFLICT' <<< "$confirm_combined"
psql -v ON_ERROR_STOP=1 -Atc "select case when count(*)=1 then 'ok' else 'bad' end from public.receivable_activity_events where receivable_id='50000000-0000-4000-a000-000000000008' and event_type='payment_confirmed';" | grep -q '^ok$'

run_race() {
  local name="$1" command_one="$2" command_two="$3"
  psql -v ON_ERROR_STOP=1 -Atc "$command_one" > "/tmp/${name}-a.out" & local first=$!
  psql -v ON_ERROR_STOP=1 -Atc "$command_two" > "/tmp/${name}-b.out" & local second=$!
  wait "$first"; wait "$second"
  local outcome
  outcome="$(cat "/tmp/${name}-a.out" "/tmp/${name}-b.out")"
  grep -q '"success": true' <<< "$outcome"
  grep -q 'RECEIVABLE_CONFLICT' <<< "$outcome"
}

# Different reports whose combined amount would overpay: one confirmation only.
run_race "different-confirm" \
  "set role service_role;select public.execute_receivable_command_v1(gen_random_uuid(),'confirm_payment','10000000-0000-4000-a000-000000000001',repeat('1',64),jsonb_build_object('receivable_id','85000000-0000-4000-a000-000000000009','expected_version',1,'payment_id','86000000-0000-4000-a000-000000000091','next_follow_up_date',current_date));" \
  "set role service_role;select public.execute_receivable_command_v1(gen_random_uuid(),'confirm_payment','10000000-0000-4000-a000-000000000001',repeat('2',64),jsonb_build_object('receivable_id','85000000-0000-4000-a000-000000000009','expected_version',1,'payment_id','86000000-0000-4000-a000-000000000092','next_follow_up_date',current_date));"
psql -Atc "select case when sum(amount) filter(where verification_status='confirmed')=600 and count(*) filter(where verification_status='confirmed')=1 then 'ok' else 'bad' end from public.receivable_payments where receivable_id='85000000-0000-4000-a000-000000000009';" | grep -q '^ok$'

# Reassignment vs stale employee follow-up.
run_race "reassign-followup" \
  "set role service_role;select public.execute_receivable_command_v1(gen_random_uuid(),'reassign','10000000-0000-4000-a000-000000000001',repeat('3',64),jsonb_build_object('receivable_id','85000000-0000-4000-a000-000000000010','expected_version',1,'assigned_to','20000000-0000-4000-a000-000000000002'));" \
  "set role service_role;select public.execute_receivable_command_v1(gen_random_uuid(),'contacted','20000000-0000-4000-a000-000000000001',repeat('4',64),jsonb_build_object('receivable_id','85000000-0000-4000-a000-000000000010','expected_version',1,'next_follow_up_date',current_date));"
psql -Atc "select case when version=2 then 'ok' else 'bad' end from public.receivables where receivable_id='85000000-0000-4000-a000-000000000010';" | grep -q '^ok$'

# Cancellation vs employee payment report.
run_race "cancel-report" \
  "set role service_role;select public.execute_receivable_command_v1(gen_random_uuid(),'cancel','10000000-0000-4000-a000-000000000001',repeat('5',64),jsonb_build_object('receivable_id','85000000-0000-4000-a000-000000000011','expected_version',1,'reason','Duplicate'));" \
  "set role service_role;select public.execute_receivable_command_v1(gen_random_uuid(),'payment_report','20000000-0000-4000-a000-000000000001',repeat('6',64),jsonb_build_object('receivable_id','85000000-0000-4000-a000-000000000011','expected_version',1,'payment_id','86000000-0000-4000-a000-000000000111','amount','100.00','payment_date',current_date));"
psql -Atc "select case when version=2 and not (lifecycle_status='cancelled' and exists(select 1 from public.receivable_payments p where p.receivable_id=r.receivable_id)) then 'ok' else 'bad' end from public.receivables r where receivable_id='85000000-0000-4000-a000-000000000011';" | grep -q '^ok$'

# Bill correction vs payment confirmation.
run_race "correct-confirm" \
  "set role service_role;select public.execute_receivable_command_v1(gen_random_uuid(),'update','10000000-0000-4000-a000-000000000001',repeat('7',64),jsonb_build_object('receivable_id','85000000-0000-4000-a000-000000000012','expected_version',1,'bill_amount','1100.00'));" \
  "set role service_role;select public.execute_receivable_command_v1(gen_random_uuid(),'confirm_payment','10000000-0000-4000-a000-000000000001',repeat('8',64),jsonb_build_object('receivable_id','85000000-0000-4000-a000-000000000012','expected_version',1,'payment_id','86000000-0000-4000-a000-000000000121','next_follow_up_date',current_date));"

# Reversal vs another confirmation.
run_race "reverse-confirm" \
  "set role service_role;select public.execute_receivable_command_v1(gen_random_uuid(),'reverse_payment','10000000-0000-4000-a000-000000000001',repeat('9',64),jsonb_build_object('receivable_id','85000000-0000-4000-a000-000000000013','expected_version',1,'payment_id','86000000-0000-4000-a000-000000000131','reason','Settlement reversed'));" \
  "set role service_role;select public.execute_receivable_command_v1(gen_random_uuid(),'confirm_payment','10000000-0000-4000-a000-000000000001',repeat('a',64),jsonb_build_object('receivable_id','85000000-0000-4000-a000-000000000013','expected_version',1,'payment_id','86000000-0000-4000-a000-000000000132'));"
psql -Atc "select case when (select outstanding_amount between 0 and bill_amount from public.receivables_financial_read_v1 where receivable_id='85000000-0000-4000-a000-000000000013') then 'ok' else 'bad' end;" | grep -q '^ok$'

# Same employee expected version from two devices.
run_race "employee-devices" \
  "set role service_role;select public.execute_receivable_command_v1(gen_random_uuid(),'contacted','20000000-0000-4000-a000-000000000001',repeat('b',64),jsonb_build_object('receivable_id','85000000-0000-4000-a000-000000000014','expected_version',1,'next_follow_up_date',current_date));" \
  "set role service_role;select public.execute_receivable_command_v1(gen_random_uuid(),'no_response','20000000-0000-4000-a000-000000000001',repeat('c',64),jsonb_build_object('receivable_id','85000000-0000-4000-a000-000000000014','expected_version',1,'next_follow_up_date',current_date));"
psql -Atc "select case when version=2 and (select count(*) from public.receivable_activity_events e where e.receivable_id=r.receivable_id)=1 then 'ok' else 'bad' end from public.receivables r where receivable_id='85000000-0000-4000-a000-000000000014';" | grep -q '^ok$'

echo "Receivables PostgreSQL integration passed."
