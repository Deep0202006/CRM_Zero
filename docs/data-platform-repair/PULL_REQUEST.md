# Server-authoritative CRM data platform

## Outcome

This repair makes Supabase the confirmed cross-device authority while retaining IndexedDB as a user-scoped cache and durable offline outbox. It preserves the existing CRM visual system.

## Included

- Authenticated, actor-derived, idempotent commands and command receipts for calls, query resolutions, mapping completions, tasks, spreadsheet targets, and field visits.
- Immutable Team KPI projection and final admin-only daily RPC.
- Stable semantic outbox operations, bounded retry, permanent-failure retention, visit evidence upload reconciliation, and logout durability.
- Lean paginated cross-device bootstrap that protects pending local mutations.
- Server-authoritative Visit Overview, complete totals, debounced refresh, on-demand signed evidence, and four-sheet export.
- Historical recovery, Data Health, backup/restore, dependency-security, and manual Supabase packages.
- Architecture guard, unit/static contracts, optional credential-gated Playwright acceptance suite, and CI.

## Deployment

No production SQL was executed and no production deployment was performed. Apply `manual-supabase/02_APPLY.sql` only after the read-only precheck and backup, then run both verification scripts. Preview and real-device acceptance remain operator steps.

## Verification

See the PR checks and the final implementation handoff for exact command exit codes. Playwright scenarios require the environment variables documented in the recovery/test package; without them, discovery is verified and acceptance tests are explicitly skipped.
