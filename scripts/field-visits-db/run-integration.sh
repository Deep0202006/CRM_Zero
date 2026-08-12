#!/usr/bin/env bash
set -euo pipefail
if [[ "${PGHOST:-}" == *"gwfjkpsoaoherntwhdyf"* ]]; then echo "Refusing production database" >&2; exit 86; fi
psql -v ON_ERROR_STOP=1 -f scripts/field-visits-db/bootstrap.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/036_field_visit_evidence_lifecycle.sql
psql -v ON_ERROR_STOP=1 -f scripts/field-visits-db/verify.sql
