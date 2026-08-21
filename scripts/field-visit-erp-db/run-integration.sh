#!/usr/bin/env bash
set -euo pipefail
if [[ "${PGHOST:-}" == *"gwfjkpsoaoherntwhdyf"* ]]; then echo "Refusing production database" >&2; exit 86; fi
psql -X -v ON_ERROR_STOP=1 -f scripts/field-visits-db/bootstrap.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/036_field_visit_evidence_lifecycle.sql
psql -X -v ON_ERROR_STOP=1 -f scripts/field-visit-erp-db/pre-048.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/048_field_visit_erp_observation.sql
psql -X -v ON_ERROR_STOP=1 -f scripts/field-visit-erp-db/verify.sql
