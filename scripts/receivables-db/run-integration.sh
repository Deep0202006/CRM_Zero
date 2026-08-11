#!/usr/bin/env bash
set -euo pipefail

psql -v ON_ERROR_STOP=1 -f scripts/receivables-db/fixture.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/033_receivables_v1.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/034_receivables_production_completion.sql
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

echo "Receivables PostgreSQL integration passed."
