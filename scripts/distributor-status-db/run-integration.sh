#!/usr/bin/env bash
set -euo pipefail
production_ref="gwfjkpsoaoherntwhdyf"
fingerprint="${PGHOST:-} ${PGDATABASE:-} ${DATABASE_URL:-} ${SUPABASE_URL:-}"
if [[ "$fingerprint" == *"$production_ref"* ]] || [[ "${PGHOST:-}" == *.supabase.co ]]; then echo "Refusing production Distributor Status fixtures." >&2;exit 86;fi
psql -v ON_ERROR_STOP=1 -f scripts/distributor-status-db/fixture.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/039_distributor_status_v1.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/040_distributor_status_v2.sql
psql -v ON_ERROR_STOP=1 -f scripts/distributor-status-db/integration.sql
base="'distributor_id','40000000-0000-4000-a000-000000000001','expected_version',3,'distributor_name','Alpha Distributor','distributor_reference','ALPHA-1','identity_key','code:alpha-1','lead_id','','phone','','assigned_to','20000000-0000-4000-a000-000000000002','installation_status','done','installation_completed_at',current_date::text,'training_status','done','training_completed_at',current_date::text,'activity_status','active','billing_status','billed','billed_at',current_date::text,'bill_reference','INV-1','renewal_date',(select renewal_date::text from distributor_accounts where distributor_id='40000000-0000-4000-a000-000000000001')"
psql -v ON_ERROR_STOP=1 -Atc "set role service_role;select public.distributor_status_command_v1(gen_random_uuid(),'10000000-0000-4000-a000-000000000001','update',repeat('d',64),jsonb_build_object($base,'city','Mumbai'));" >/tmp/distributor-a.out & first=$!
psql -v ON_ERROR_STOP=1 -Atc "set role service_role;select public.distributor_status_command_v1(gen_random_uuid(),'10000000-0000-4000-a000-000000000001','update',repeat('e',64),jsonb_build_object($base,'city','Pune'));" >/tmp/distributor-b.out & second=$!
wait "$first";wait "$second"
combined="$(cat /tmp/distributor-a.out /tmp/distributor-b.out)"
grep -q '"success": true' <<<"$combined"
grep -q 'DISTRIBUTOR_CONFLICT' <<<"$combined"
psql -Atc "select case when version=4 and city in ('Mumbai','Pune') then 'ok' else 'bad' end from distributor_accounts where distributor_id='40000000-0000-4000-a000-000000000001';" | grep -q '^ok$'
run_parallel_same_operation(){
  local name="$1" sql="$2"
  psql -v ON_ERROR_STOP=1 -Atc "$sql" >"/tmp/${name}-a.out" & local first=$!
  psql -v ON_ERROR_STOP=1 -Atc "$sql" >"/tmp/${name}-b.out" & local second=$!
  wait "$first";wait "$second"
  diff -u "/tmp/${name}-a.out" "/tmp/${name}-b.out"
  grep -q '"success": true' "/tmp/${name}-a.out"
}
create_sql="set role service_role;select public.distributor_status_command_v1('30000000-0000-4000-a000-000000000040','10000000-0000-4000-a000-000000000001','create',repeat('7',64),jsonb_build_object('distributor_id','40000000-0000-4000-a000-000000000040','distributor_name','Parallel Create','distributor_reference','PAR-40','identity_key','code:par-40','lead_id','','phone','','city','','assigned_to','20000000-0000-4000-a000-000000000001','installation_status','pending','installation_completed_at','','training_status','pending','training_completed_at','','activity_status','not_applicable','billing_status','not_billed','billed_at','','bill_reference','','renewal_date',''));"
run_parallel_same_operation create "$create_sql"
psql -Atc "select case when count(*)=1 then 'ok' else 'bad' end from distributor_accounts where distributor_id='40000000-0000-4000-a000-000000000040';select case when count(*)=1 then 'ok' else 'bad' end from distributor_status_events where distributor_id='40000000-0000-4000-a000-000000000040';" | grep -qv '^bad$'
parallel_base="'distributor_id','40000000-0000-4000-a000-000000000001','expected_version',4,'distributor_name','Alpha Distributor','distributor_reference','ALPHA-1','identity_key','code:alpha-1','lead_id','','phone','','assigned_to','20000000-0000-4000-a000-000000000002','installation_status','done','installation_completed_at',current_date::text,'training_status','done','training_completed_at',current_date::text,'activity_status','active','billing_status','billed','billed_at',current_date::text,'bill_reference','INV-1','renewal_date',(select renewal_date::text from distributor_accounts where distributor_id='40000000-0000-4000-a000-000000000001')"
update_sql="set role service_role;select public.distributor_status_command_v1('30000000-0000-4000-a000-000000000041','10000000-0000-4000-a000-000000000001','update',repeat('8',64),jsonb_build_object($parallel_base,'city','Parallel Update'));"
run_parallel_same_operation update "$update_sql"
renew_sql="set role service_role;select public.distributor_status_command_v1('30000000-0000-4000-a000-000000000042','10000000-0000-4000-a000-000000000001','renew',repeat('9',64),jsonb_build_object($parallel_base,'city','Parallel Update','expected_version',5,'renewal_date',((now() at time zone 'Asia/Kolkata')::date+60)::text));"
run_parallel_same_operation renew "$renew_sql"
import_rows="jsonb_build_array(jsonb_build_object('rowNumber',2,'classification','NEW','payload',jsonb_build_object('distributor_id','40000000-0000-4000-a000-000000000043','distributor_name','Parallel Import','distributor_reference','PAR-43','identity_key','code:par-43','assigned_to','20000000-0000-4000-a000-000000000001','installation_status','pending','installation_completed_at',null,'training_status','pending','training_completed_at',null,'activity_status','not_applicable','billing_status','not_billed','billed_at',null,'bill_reference','','renewal_date',null)))"
import_sql="set role service_role;select public.import_distributor_status_v1('30000000-0000-4000-a000-000000000043','10000000-0000-4000-a000-000000000001',repeat('a',64),'parallel.xlsx',$import_rows);"
run_parallel_same_operation import "$import_sql"
psql -Atc "select case when count(*)=1 then 'ok' else 'bad' end from distributor_accounts where distributor_id='40000000-0000-4000-a000-000000000043';select case when count(*)=1 then 'ok' else 'bad' end from distributor_import_batches where operation_id='30000000-0000-4000-a000-000000000043';" | grep -qv '^bad$'
psql -v ON_ERROR_STOP=1 -f supabase/migrations/041_distributor_mapped_status.sql
psql -v ON_ERROR_STOP=1 -f scripts/distributor-status-db/mapping-integration.sql
