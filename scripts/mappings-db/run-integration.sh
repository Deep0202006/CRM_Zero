#!/usr/bin/env bash
set -euo pipefail
if [[ "${PGHOST:-}" == *"gwfjkpsoaoherntwhdyf"* || "${DATABASE_URL:-}" == *"gwfjkpsoaoherntwhdyf"* ]]; then echo "Refusing production database" >&2; exit 86; fi
psql -X -v ON_ERROR_STOP=1 -f scripts/mappings-db/bootstrap.sql
# A precondition failure must roll the whole real migration back.
psql -X -v ON_ERROR_STOP=1 -c "insert into public.mapping_requests(request_id,distributor_name_unregistered,retailer_name_unregistered,requested_by,status) values ('20000000-0000-4000-8000-000000000099','bad','bad',null,'Pending')"
if psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/051_mapping_attribution_visibility.sql; then echo "unsafe fixture unexpectedly migrated" >&2; exit 1; fi
test -z "$(psql -X -Atqc \"select 1 from information_schema.columns where table_schema='public' and table_name='mapping_requests' and column_name='requested_by_id_snapshot'\")"
psql -X -v ON_ERROR_STOP=1 -f scripts/mappings-db/bootstrap.sql
psql -X -v ON_ERROR_STOP=1 -f supabase/migrations/051_mapping_attribution_visibility.sql
psql -X -v ON_ERROR_STOP=1 -f scripts/mappings-db/verify.sql
