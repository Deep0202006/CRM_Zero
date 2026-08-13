#!/usr/bin/env bash
set -euo pipefail
production_ref="gwfjkpsoaoherntwhdyf"
fingerprint="${PGHOST:-} ${PGDATABASE:-} ${DATABASE_URL:-} ${SUPABASE_URL:-}"
if [[ "$fingerprint" == *"$production_ref"* ]] || [[ "${PGHOST:-}" == *.supabase.co ]]; then echo "Refusing production Distributor Status fixtures." >&2;exit 86;fi
psql -v ON_ERROR_STOP=1 -f scripts/distributor-status-db/fixture.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/039_distributor_status_v1.sql
psql -v ON_ERROR_STOP=1 -f scripts/distributor-status-db/integration.sql
base="'distributor_id','40000000-0000-4000-a000-000000000001','expected_version',1,'distributor_name','Alpha Distributor','distributor_reference','ALPHA-1','identity_key','code:alpha-1','lead_id','','phone','','assigned_to','20000000-0000-4000-a000-000000000001','installation_status','done','installation_completed_at',current_date::text,'training_status','done','training_completed_at',current_date::text,'activity_status','active','billing_status','billed','billed_at',current_date::text,'bill_reference','INV-1','renewal_date',(current_date+2)::text"
psql -v ON_ERROR_STOP=1 -Atc "set role service_role;select public.distributor_status_command_v1(gen_random_uuid(),'10000000-0000-4000-a000-000000000001','update',repeat('d',64),jsonb_build_object($base,'city','Mumbai'));" >/tmp/distributor-a.out & first=$!
psql -v ON_ERROR_STOP=1 -Atc "set role service_role;select public.distributor_status_command_v1(gen_random_uuid(),'10000000-0000-4000-a000-000000000001','update',repeat('e',64),jsonb_build_object($base,'city','Pune'));" >/tmp/distributor-b.out & second=$!
wait "$first";wait "$second"
combined="$(cat /tmp/distributor-a.out /tmp/distributor-b.out)"
grep -q '"success": true' <<<"$combined"
grep -q 'DISTRIBUTOR_CONFLICT' <<<"$combined"
psql -Atc "select case when version=2 and city in ('Mumbai','Pune') then 'ok' else 'bad' end from distributor_accounts where distributor_id='40000000-0000-4000-a000-000000000001';" | grep -q '^ok$'
