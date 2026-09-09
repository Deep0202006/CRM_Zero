#!/usr/bin/env bash
set -euo pipefail
if [[ "$(uname -s)" != "Linux" || "${GITHUB_ACTIONS:-}" != "true" || "${CRM_POSTGRES_SERVICE_DISPOSABLE:-}" != "1" || "${PGHOST:-}" != "127.0.0.1" || ! "${PGDATABASE:-}" =~ ^kernel_bcd_readers_postgres_[a-f0-9]{8}_0$ ]]; then
  echo "B-D fixtures require the registered disposable database" >&2; exit 86
fi
case "${1:-}" in
  schema)
    # Reuse tracked production definitions, not a second hand-maintained schema.
    awk '/^CREATE TYPE lead_segment / || /^CREATE TYPE lead_status / {print} /^-- 1. Users Table/,/^-- 5. Client Queries Table/ {print}' supabase/schema.sql | psql -X -v ON_ERROR_STOP=1
    awk '/^CREATE TABLE IF NOT EXISTS public.field_visits/,/^-- Create index on sync_status/ {print}' supabase/migrations/021_field_visits_hardening.sql | psql -X -v ON_ERROR_STOP=1
    awk '/^CREATE INDEX IF NOT EXISTS idx_field_visits_user_date / || /^CREATE INDEX IF NOT EXISTS idx_field_visits_lead_id / {print}' supabase/migrations/019_field_visits.sql | psql -X -v ON_ERROR_STOP=1
    awk '/^ALTER TABLE public.field_visits$/,/^  ADD COLUMN IF NOT EXISTS selfie_storage_path text;/ {print; if (/^  ADD COLUMN IF NOT EXISTS selfie_storage_path text;/) exit}' supabase/migrations/022_field_visits_production_hardening.sql | psql -X -v ON_ERROR_STOP=1
    awk '/^ALTER TABLE public.field_visits$/,/^  ADD COLUMN IF NOT EXISTS pincode text NULL;/ {print; if (/^  ADD COLUMN IF NOT EXISTS pincode text NULL;/) exit}' supabase/migrations/044_field_visit_pincode.sql | psql -X -v ON_ERROR_STOP=1
    awk '/^alter table public.field_visits$/,/^  add column if not exists selfie_purge_started_at timestamptz;/ {print; if (/^  add column if not exists selfie_purge_started_at timestamptz;/) exit}' supabase/migrations/036_field_visit_evidence_lifecycle.sql | psql -X -v ON_ERROR_STOP=1
    psql -X -v ON_ERROR_STOP=1 -f scripts/bcd-db/synthetic-schema.sql
    awk '/^create or replace function public.erp_normalized_key_v1/,/^grant all on public.erp_systems to service_role;/ {print}' supabase/migrations/047_distributor_erp_partner_visibility.sql | psql -X -v ON_ERROR_STOP=1
    awk '/^alter table public.field_visits$/,/^create or replace function public.confirm_field_visit_erp_v1/ {if (/^create or replace function/) exit; print}' supabase/migrations/048_field_visit_erp_observation.sql | psql -X -v ON_ERROR_STOP=1
    awk '/^create or replace function public.field_visit_erp_intelligence_v1/,/^grant execute on function public.field_visit_erp_intelligence_v1/ {print}' supabase/migrations/048_field_visit_erp_observation.sql | psql -X -v ON_ERROR_STOP=1
    psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/055_crm_bcd_readers.sql ;;
  fixture) psql -X -v ON_ERROR_STOP=1 -f scripts/bcd-db/fixture.sql ;;
  assertion)
    psql -X -v ON_ERROR_STOP=1 -f scripts/bcd-db/assertion.sql
    node scripts/bcd-db/http.mjs ;;
  *) echo "Expected schema, fixture or assertion" >&2; exit 64 ;;
esac
