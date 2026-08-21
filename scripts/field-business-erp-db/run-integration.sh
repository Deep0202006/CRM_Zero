#!/usr/bin/env bash
set -euo pipefail
if [[ "${PGHOST:-}" == *"gwfjkpsoaoherntwhdyf"* ]]; then echo "Refusing production database" >&2; exit 86; fi
psql -X -v ON_ERROR_STOP=1 -f scripts/field-visits-db/bootstrap.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/036_field_visit_evidence_lifecycle.sql
psql -X -v ON_ERROR_STOP=1 -f scripts/field-visit-erp-db/pre-048.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/048_field_visit_erp_observation.sql
psql -X -v ON_ERROR_STOP=1 -f scripts/field-business-erp-db/pre-049.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/049_field_business_erp_baseline.sql
psql -X -v ON_ERROR_STOP=1 -f scripts/field-business-erp-db/verify.sql

# CI supplies an external path so a durable exact-head artifact is emitted only
# after every PostgreSQL assertion above succeeds. Local runs need no artifact.
if [[ -n "${CRM_P1_049_PROOF_PATH:-}" ]]; then
  mkdir -p "$(dirname -- "$CRM_P1_049_PROOF_PATH")"
  {
    echo "task=CRM-P1-049"
    echo "acceptance=P1-049-V01"
    echo "commit=${GITHUB_SHA:-unknown}"
    echo "postgres=$(psql --version)"
    echo "migration049_sha256=$(sha256sum supabase/migrations/049_field_business_erp_baseline.sql | awk '{print $1}')"
    echo "matrix_sha256=$(sha256sum scripts/field-business-erp-db/verify.sql | awk '{print $1}')"
    echo "result=PASS"
  } > "$CRM_P1_049_PROOF_PATH"
fi
