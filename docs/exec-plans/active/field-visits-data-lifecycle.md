# Execution Plan: Field Visits Data Lifecycle and Free Supabase Hardening

## Goal

Add a safe five-day evidence-file lifecycle, mandatory new-visit address, distributor-only observational `payment_done`, and a substantially clearer bounded Admin Visits Overview without losing historical or offline work or increasing idle egress.

## Non-goals

- No production migration, data write, cleanup run, backup, or synthetic production test.
- No deletion or rewriting of attendance, visits, leads, calls, users, tasks, or financial records.
- No automatic financial action from a field-visit outcome.
- No weakening of selfie, GPS, offline durability, confirmation, Realtime, or Payment Collections authority.

## Current state

Production at the read-only audit has 158 `field_visits`, 129 `attendance` rows, 66 `field_visit_media` rows, and one private `visits-evidence` bucket containing 195 objects averaging 105,607 bytes (maximum 142,757 bytes). Visits use `check_in_photo_url` and `selfie_storage_path`; attendance uses `selfie_url`. Neither table has address/upload/purge lifecycle columns. The Admin overview is server-paginated at 50 rows and signed evidence is already explicit-request only.

All 14 populated production attendance `selfie_url` values are legacy embedded `data:` URLs and none reference Storage. Future attendance evidence uses exact-key private Storage upload. The existing payloads remain readable until the separately owner-authorized, cutoff-bound cleanup clears only their image payload and records lifecycle metadata.

## Invariants

- Business rows and permanent metadata are never cleanup targets.
- Exact Storage keys come only from authoritative attendance/visit rows and the exact `visits-evidence` bucket.
- A failed object deletion cannot mark evidence purged; retries are idempotent and bounded.
- Historic null addresses render as legacy, never fabricated values.
- Pre-address local visits retain the same visit/operation ID and all media until the user supplies address.
- `payment_done` cannot write Receivables, lead payment details, Pipeline, or Calls.
- Existing 30-minute hydration cap, serialized hydration, terminal call-outbox handling, retry backoff, and Realtime behavior remain intact.

## Affected domains

Field Visits, Attendance evidence metadata, private Storage evidence, offline recovery, admin reporting/export, Engineering OS, and Vercel cron configuration.

## Implementation steps

1. Complete read-only code/schema/log audit and freeze exact retention semantics.
2. Add additive migration 036 with nullable historical-compatible fields, new-write constraints, outcome rules, and evidence-cleanup indexes; do not apply it.
3. Extend canonical/local/offline contracts and server confirmation, including address repair on the same queued visit ID.
4. Add bounded server-only cleanup planning/execution and authenticated daily cron endpoint using exact Storage API deletion.
5. Extend explicit evidence status/loading and rebuild bounded overview/detail/filter/export presentation.
6. Add synthetic unit, route, migration integration, E2E, lifecycle, financial-isolation, egress, and compatibility tests.
7. Update only the relevant contracts, skill, lifecycle/authority rules, lesson, backup runbook, and harness guards.
8. Verify, review, open a PR and preview, then stop before merge/production until the owner reports `MIGRATION APPLIED`.

## Verification

Focused field-visit and retention suites, disposable PostgreSQL migration tests, E2E at desktop/tablet/mobile, typecheck, lint, build, `npm run harness:verify`, and static guards proving no row deletion, broad Storage deletion, automatic image fetch, or financial mutation.

## Production safety

- [x] Production mutation is not authorized and will not be performed.
- [ ] Schema migration will be prepared but requires owner manual application.
- [x] Read-only production schema/storage aggregate audit completed.
- [x] Secrets and production connections are excluded from CI/local tests.

## Rollback

Before migration: revert application/cron configuration. After owner migration but before release: leave additive nullable columns unused. After release: disable the Vercel cron/endpoint and revert application code; never roll back by deleting business data or evidence metadata.

## Decision log

- 2026-08-12: Classified R3 due to schema and service-role Storage cleanup.
- 2026-08-12: Retention boundary is `uploaded_at <= now - interval '5 days'` in UTC; captured time does not start retention.
- 2026-08-12: Existing ~106 KB average evidence means no blind extra compression; preserve the current visually clear pipeline and test its upper bounds/orientation.
- 2026-08-12: Legacy attendance data URLs remain backward-compatible inputs; only the separate owner-authorized initial cleanup may clear their payload through the frozen cutoff after its aggregate dry-run assertions pass.

## Progress

- [x] Fetch and verify `origin/main` at `8323524979b5c3a572b08870fae6d40ae94d9924`.
- [x] Read-only production table/constraint/policy/index/bucket aggregate audit.
- [x] Complete implementation audit and code changes.
- [x] Complete local verification (410 Jest tests, typecheck, lint with zero errors, build, four critical browser E2E tests, and R3 harness).
- [ ] Commit, PR, CI, and Vercel Preview.
- [ ] Owner manually applies migration.
- [ ] Merge, production deploy, cron verification, and read-only post-release logs.
