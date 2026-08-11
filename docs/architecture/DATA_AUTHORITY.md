# Data Authority

## CURRENT

Supabase-confirmed rows are authoritative across devices. IndexedDB holds durable local/offline recovery state and pending operations. The sync queue retries pending writes. Team KPI and admin reporting aggregate server data rather than browser totals.

Receivables financial state is server authoritative: PostgreSQL numeric calculations and confirmed, non-reversed payments determine paid and outstanding amounts. A browser payment report or uncertain command is never confirmed money.

## INVARIANT

Stable IDs survive retry. Confirmed server rows are not deleted to reconcile local state. Unknown records are preserved. Production verification requires read-only introspection; migrations alone do not prove deployed state.

## KNOWN DEBT

Compatibility fallbacks exist for historical schemas and evidence fields; they must remain conservative and observable.
