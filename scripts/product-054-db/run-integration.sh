#!/usr/bin/env bash
set -euo pipefail

fingerprint="${PGHOST:-} ${PGDATABASE:-} ${DATABASE_URL:-} ${SUPABASE_URL:-} ${NEXT_PUBLIC_SUPABASE_URL:-}"
if [[ "${CRM_POSTGRES_SERVICE_DISPOSABLE:-}" != "1" ]] || [[ "$fingerprint" == *"gwfjkpsoaoherntwhdyf"* ]] || [[ "${PGHOST:-}" == *.supabase.co ]]; then
  echo "Refusing Product 054 fixtures outside disposable PostgreSQL." >&2
  exit 86
fi

phase="${1:-}"
if [[ ! "$phase" =~ ^(schema|fixture|assertion)$ ]]; then
  echo "Usage: $0 schema|fixture|assertion" >&2
  exit 64
fi

if [[ "$phase" == "schema" ]]; then
psql -X -v ON_ERROR_STOP=1 -f scripts/receivables-db/fixture.sql
for migration in 033_receivables_v1 034_receivables_production_completion 035_receivables_import_linearization 039_distributor_status_v1 040_distributor_status_v2 041_distributor_mapped_status 042_payment_collection_renewals; do
  psql -X -v ON_ERROR_STOP=1 -f "supabase/migrations/${migration}.sql"
done
psql -X -v ON_ERROR_STOP=1 -f scripts/receivables-db/canonical-link-before.sql
for migration in 045_distributor_receivable_canonical_link 046_unified_distributor_master_import; do
  psql -X -v ON_ERROR_STOP=1 -f "supabase/migrations/${migration}.sql"
done
psql -X -v ON_ERROR_STOP=1 -f scripts/erp-visibility-db/pre-047.sql
for migration in 047_distributor_erp_partner_visibility 050_distributor_erp_footprint 052_billed_renewals_erp_payment_status 053_erp_partner_distributor_status_filters; do
  psql -X -v ON_ERROR_STOP=1 -f "supabase/migrations/${migration}.sql"
done
awk '/^create function public.has_capability/,/^grant select on public.users/' scripts/mappings-db/bootstrap.sql | psql -X -v ON_ERROR_STOP=1
awk '/^-- 10. Call Logs Table/,/^-- 11. Task Upload Batches Table/' supabase/schema.sql | psql -X -v ON_ERROR_STOP=1
sed -n '11,28p' supabase/migrations/029_team_kpi_source_sync_repair.sql | psql -X -v ON_ERROR_STOP=1
sed -n '132,190p' supabase/migrations/029_team_kpi_source_sync_repair.sql | psql -X -v ON_ERROR_STOP=1
psql -X -v ON_ERROR_STOP=1 -c 'grant select,insert,update,delete on public.call_logs to authenticated'
psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/051_mapping_attribution_visibility.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/054_creator_updates_billed_erp_payment.sql
exit 0
fi

if [[ "$phase" == "fixture" ]]; then
psql -X -v ON_ERROR_STOP=1 -c "insert into public.users(user_id,name,email,is_active) values('92000000-0000-4000-a000-000000000002','Second Employee','second-employee@example.test',true) on conflict do nothing"
psql -X -v ON_ERROR_STOP=1 -c "insert into public.user_capabilities(user_id,capability_code) values('92000000-0000-4000-a000-000000000001','ret_support'),('92000000-0000-4000-a000-000000000002','ret_support') on conflict do nothing"
exit 0
fi

psql -X -v ON_ERROR_STOP=1 -f scripts/product-054-db/integration.sql

echo "Product 054 focused PostgreSQL regression passed."
