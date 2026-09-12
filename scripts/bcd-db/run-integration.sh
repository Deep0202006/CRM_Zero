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
    # Reuse the exact task/call and Pipeline definitions needed by the read slice.
    awk '/^CREATE TABLE IF NOT EXISTS call_logs/,/^-- 11\. Task Upload Batches Table/ {print}' supabase/schema.sql | psql -X -v ON_ERROR_STOP=1
    awk '/^-- PART 1B/,/^-- PART 1D/ {print}' supabase/migrations/002_addendum.sql | psql -X -v ON_ERROR_STOP=1
    awk '/^ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS stage_entered_at/,/;$/ {print}' supabase/migrations/002_addendum.sql | psql -X -v ON_ERROR_STOP=1
    awk '/^alter table public.leads add column if not exists lead_source/,/;$/ {print} /^alter table public.leads add column if not exists area / {print}' supabase/migrations/003_pipeline_optimization.sql | psql -X -v ON_ERROR_STOP=1
    awk '/^create or replace function public.transition_lead_stage_v2/ {exit} {print}' supabase/migrations/032_pipeline_authoritative_transitions.sql | psql -X -v ON_ERROR_STOP=1
    awk '/^-- Pipeline may not create employee work/ {exit} {print}' supabase/migrations/037_pipeline_authority_and_resource_budget.sql | psql -X -v ON_ERROR_STOP=1
    psql -X -v ON_ERROR_STOP=1 -c 'grant select on public.tasks,public.call_logs,public.pipeline_transition_operations to service_role;'
    awk '/^ALTER TABLE public.call_logs/ {active=1} /^ALTER TABLE public.client_queries/ {exit} active {print}' supabase/migrations/029_team_kpi_source_sync_repair.sql | psql -X -v ON_ERROR_STOP=1
    awk '/^CREATE TABLE IF NOT EXISTS public.mapping_requests /,/^\);/ {print} /^ALTER TABLE public.mapping_requests ENABLE ROW LEVEL SECURITY/ {print}' supabase/migrations/006_mapping_requests.sql | psql -X -v ON_ERROR_STOP=1
    awk '/^ALTER TABLE public.mapping_requests$/,/ADD COLUMN IF NOT EXISTS requested_by.*;/ {print}' supabase/migrations/026_team_kpi_repair.sql | psql -X -v ON_ERROR_STOP=1
    psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/044_field_visit_pincode.sql
    psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/051_mapping_attribution_visibility.sql
    awk '/^alter table public.mapping_requests/ {active=1} /^alter table public.distributor_accounts add constraint/ {exit} active {print}' supabase/migrations/054_creator_updates_billed_erp_payment.sql | psql -X -v ON_ERROR_STOP=1
    awk '/^CREATE INDEX IF NOT EXISTS idx_call_logs_kpi_user_timestamp/,/;$/ {print} /^CREATE INDEX IF NOT EXISTS idx_mapping_requests_kpi_mapper_time/,/;$/ {print}' supabase/migrations/029_team_kpi_source_sync_repair.sql | psql -X -v ON_ERROR_STOP=1
    psql -X -v ON_ERROR_STOP=1 -c 'grant select on public.mapping_requests to service_role; grant select on public.users,public.user_capabilities to authenticated; grant select,insert,update on public.mapping_requests to authenticated;'
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
