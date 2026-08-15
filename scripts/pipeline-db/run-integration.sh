#!/usr/bin/env bash
set -euo pipefail
fingerprint="${PGHOST:-} ${PGDATABASE:-} ${DATABASE_URL:-} ${SUPABASE_URL:-} ${NEXT_PUBLIC_SUPABASE_URL:-}"
if [[ "$fingerprint" == *"gwfjkpsoaoherntwhdyf"* ]] || [[ "${PGHOST:-}" == *.supabase.co ]]; then echo "Refusing production database" >&2; exit 86; fi
psql -v ON_ERROR_STOP=1 -f scripts/pipeline-db/bootstrap.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/032_pipeline_authoritative_transitions.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/037_pipeline_authority_and_resource_budget.sql
psql -v ON_ERROR_STOP=1 -f scripts/pipeline-db/verify-037.sql
psql -v ON_ERROR_STOP=1 <<'SQL'
set request.jwt.claim.sub = '10000000-0000-4000-a000-000000000001';
\i supabase/migrations/038_retailer_payment_to_converted.sql
SQL
psql -v ON_ERROR_STOP=1 -f scripts/pipeline-db/verify.sql | grep -q 'system-audit-ok'
psql -v ON_ERROR_STOP=1 -f scripts/pipeline-db/bootstrap-043.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/043_pipeline_creation_authority.sql
psql -v ON_ERROR_STOP=1 -f scripts/pipeline-db/verify-043.sql | tee /tmp/pipeline-verify-043.out
grep -q 'pooja-history-ok' /tmp/pipeline-verify-043.out

# Two tabs race from the same expected state: exactly one transition commits.
psql -v ON_ERROR_STOP=1 -c "select public.pipeline_create_lead_v1('61000000-0000-4000-a000-000000000001','60000000-0000-4000-a000-000000000001','10000000-0000-4000-a000-000000000001','Race','Person','1','Retailer','Cold Call','Area',now())"
race_a="select public.transition_lead_stage_v2('70000000-0000-4000-a000-000000000001','60000000-0000-4000-a000-000000000001','New','Contacted','10000000-0000-4000-a000-000000000001');"
race_b="select public.transition_lead_stage_v2('70000000-0000-4000-a000-000000000002','60000000-0000-4000-a000-000000000001','New','Contacted','10000000-0000-4000-a000-000000000001');"
psql -v ON_ERROR_STOP=1 -Atc "$race_a" >/tmp/pipeline-race-a.out & first=$!
psql -v ON_ERROR_STOP=1 -Atc "$race_b" >/tmp/pipeline-race-b.out & second=$!
wait "$first"; wait "$second"
combined="$(cat /tmp/pipeline-race-a.out /tmp/pipeline-race-b.out)"
grep -q '"success": true' <<<"$combined"
grep -q 'PIPELINE_CONFLICT' <<<"$combined"
psql -Atc "select case when count(*)=1 then 'ok' else 'bad' end from public.pipeline_transition_operations where lead_id='60000000-0000-4000-a000-000000000001'" | grep -q '^ok$'

# Two different operations for one strong identity serialize and create one row.
create_a="select public.pipeline_create_lead_v1('84000000-0000-4000-a000-000000000001','85000000-0000-4000-a000-000000000001','10000000-0000-4000-a000-000000000001','Concurrent Medical','Person','9990001111','Retailer','Cold Call','Anand',now());"
create_b="select public.pipeline_create_lead_v1('84000000-0000-4000-a000-000000000002','85000000-0000-4000-a000-000000000002','10000000-0000-4000-a000-000000000002','CONCURRENT MEDICAL','Person','999-000-1111','Retailer','Referral','ANAND',now());"
psql -v ON_ERROR_STOP=1 -Atc "$create_a" >/tmp/pipeline-create-a.out & first=$!
psql -v ON_ERROR_STOP=1 -Atc "$create_b" >/tmp/pipeline-create-b.out & second=$!
wait "$first"; wait "$second"
combined="$(cat /tmp/pipeline-create-a.out /tmp/pipeline-create-b.out)"
grep -q 'LEAD_CREATED' <<<"$combined"
grep -q 'LEAD_ALREADY_EXISTS' <<<"$combined"
psql -Atc "select case when count(*)=1 then 'ok' else 'bad' end from public.leads where public.pipeline_normalize_identity_text(business_name)='concurrentmedical'" | grep -q '^ok$'
echo "Pipeline PostgreSQL integration passed."
