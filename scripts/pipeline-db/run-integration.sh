#!/usr/bin/env bash
set -euo pipefail
fingerprint="${PGHOST:-} ${PGDATABASE:-} ${DATABASE_URL:-} ${SUPABASE_URL:-} ${NEXT_PUBLIC_SUPABASE_URL:-}"
if [[ "$fingerprint" == *"gwfjkpsoaoherntwhdyf"* ]] || [[ "${PGHOST:-}" == *.supabase.co ]]; then echo "Refusing production database" >&2; exit 86; fi
psql -v ON_ERROR_STOP=1 -f scripts/pipeline-db/bootstrap.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/037_pipeline_authority_and_resource_budget.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/038_retailer_payment_to_converted.sql
psql -v ON_ERROR_STOP=1 -f scripts/pipeline-db/verify.sql | grep -q 'system-audit-ok'

# Two tabs race from the same expected state: exactly one transition commits.
psql -v ON_ERROR_STOP=1 -c "insert into public.leads(lead_id,business_name,contact_person,phone,segment_type,status,assigned_to) values('60000000-0000-4000-a000-000000000001','Race','Person','1','Retailer','New','10000000-0000-4000-a000-000000000001')"
race_a="select public.transition_lead_stage_v2('70000000-0000-4000-a000-000000000001','60000000-0000-4000-a000-000000000001','New','Contacted','10000000-0000-4000-a000-000000000001');"
race_b="select public.transition_lead_stage_v2('70000000-0000-4000-a000-000000000002','60000000-0000-4000-a000-000000000001','New','Contacted','10000000-0000-4000-a000-000000000001');"
psql -v ON_ERROR_STOP=1 -Atc "$race_a" >/tmp/pipeline-race-a.out & first=$!
psql -v ON_ERROR_STOP=1 -Atc "$race_b" >/tmp/pipeline-race-b.out & second=$!
wait "$first"; wait "$second"
combined="$(cat /tmp/pipeline-race-a.out /tmp/pipeline-race-b.out)"
grep -q '"success": true' <<<"$combined"
grep -q 'PIPELINE_CONFLICT' <<<"$combined"
psql -Atc "select case when count(*)=1 then 'ok' else 'bad' end from public.pipeline_transition_operations where lead_id='60000000-0000-4000-a000-000000000001'" | grep -q '^ok$'
echo "Pipeline PostgreSQL integration passed."
