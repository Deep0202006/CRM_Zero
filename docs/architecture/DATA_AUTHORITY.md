# Data Authority

## CURRENT

Supabase-confirmed rows are authoritative across devices. IndexedDB holds durable local/offline recovery state and pending operations. The sync queue retries pending writes. Team KPI and admin reporting aggregate server data rather than browser totals.

Receivables financial state is server authoritative: PostgreSQL numeric calculations and confirmed, non-reversed payments determine paid and outstanding amounts. A browser payment report or uncertain command is never confirmed money. Receivables assignment is also authoritative: server-listed active operational employees are convenience, while PostgreSQL rejects inactive or Admin assignees.

Distributor Status is a separate operational authority keyed by one internal distributor account ID. It owns installation, training, activity, billed indication, assignment, current renewal date, and their audit history. Receivables may resolve and display that account but remains the only financial authority; Distributor Status writes no Lead, financial, Pipeline, Task, Call, Visit, Attendance, or Chat row. Renewal reminders are derived from the authoritative date in IST rather than generated work.

ERP identity is canonical in `public.erp_systems`; a Distributor's ERP assignment is owned only by `public.distributor_accounts.erp_id`. Renewal and Payment Collection are readers through canonical `distributor_id`, never duplicate owners. External ERP authorization is separately owned by `public.erp_partner_scopes`; its dedicated projections are data-minimized and confer no operational or financial mutation authority.

Field-visit `payment_done` is an observation, never financial confirmation. Payment Collections alone owns Receivables payment mutations. Permanent visit/attendance rows and metadata remain authoritative after temporary evidence objects expire.

Pipeline is a global read model for active CRM users. Ordinary Lead mutation belongs only to the assigned owner; Admin status is not an override. The authoritative transition boundary writes Lead state plus Pipeline audit/idempotency only. Pipeline never creates Tasks, Calls, Visits, Receivables, payments, or chat records, and Calls never create Leads or Pipeline transitions.

## INVARIANT

Stable IDs survive retry. Confirmed server rows are not deleted to reconcile local state. Unknown records are preserved. Production verification requires read-only introspection; migrations alone do not prove deployed state.

## KNOWN DEBT

Compatibility fallbacks exist for historical schemas and evidence fields; they must remain conservative and observable.
