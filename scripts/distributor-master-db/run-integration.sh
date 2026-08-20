#!/usr/bin/env bash
set -euo pipefail

production_ref="gwfjkpsoaoherntwhdyf"
fingerprint="${PGHOST:-} ${PGDATABASE:-} ${DATABASE_URL:-} ${SUPABASE_URL:-} ${NEXT_PUBLIC_SUPABASE_URL:-}"
if [[ "${CRM_MASTER_DB_DISPOSABLE:-}" != "1" ]]; then
  echo "Refusing master-import fixtures without CRM_MASTER_DB_DISPOSABLE=1." >&2
  exit 85
fi
if [[ "$fingerprint" == *"$production_ref"* ]] || [[ "${PGHOST:-}" == *.supabase.co ]]; then
  echo "Refusing master-import fixtures against a production Supabase target." >&2
  exit 86
fi

psql -X -v ON_ERROR_STOP=1 -f scripts/receivables-db/fixture.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/033_receivables_v1.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/034_receivables_production_completion.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/035_receivables_import_linearization.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/039_distributor_status_v1.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/040_distributor_status_v2.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/041_distributor_mapped_status.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/042_payment_collection_renewals.sql
psql -X -v ON_ERROR_STOP=1 -f scripts/receivables-db/canonical-link-before.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/045_distributor_receivable_canonical_link.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/046_unified_distributor_master_import.sql
psql -X -v ON_ERROR_STOP=1 -f scripts/distributor-master-db/integration.sql
bash scripts/distributor-master-db/concurrency.sh

echo "Distributor master PostgreSQL integration passed."
