# Execution Plan: Attendance release completion

## Goal

Close the remaining Attendance release gates after PR #33: write-to-read closure for every production-derived eligible role shape, explicit durable queue versioning, required field location, retention failure recovery, and production evidence on the exact deployed SHA.

## Non-goals

- No production test records, queue deletion, business-row repair, schema migration, or Distributor/Payment work.
- No change to Attendance authority, selfie retention duration, or existing stable IDs.

## Current state

PR #33 is merged as `57028bf876f473c0c52f4100fce0f8030b4fba89` and Vercel production is READY. It normalizes known legacy evidence metadata and stops terminal 4xx replay. Current envelopes are unversioned and field capture stores null location. Production has three active eligible capability shapes; all have valid auth linkage. Natural post-deploy confirmation traffic has not occurred yet.

## Invariants

- Attendance rows are permanent server authority; selfies are temporary evidence.
- Existing queue entries and evidence are preserved and normalized in place.
- Stable Attendance IDs and original capture timestamps/dates survive every replay.
- Only network, 408, 429, and 5xx responses retry automatically with bounded backoff.
- No protected-domain writes.

## Affected domains

Attendance, offline synchronization, selfie evidence lifecycle, Engineering OS.

## Implementation steps

1. Add a versioned Attendance queue envelope and deterministic normalizers for unversioned/v1 and current payloads.
2. Capture required geolocation for field Attendance and validate the coordinate pair server-side.
3. Freeze the actual identity/role matrix and add a permanent Attendance write-to-read closure test for field and non-field variants.
4. Preserve the existing date rule; add no new late-sync policy. Add runtime tests for current/legacy replay, terminal/transient failures, IST, identity, retention recovery, and protected write sets.
5. Update the existing contract/ledger and add only robust harness enforcement.
6. Run the focused-to-full R3 verification ladder, review the diff, open a PR, pass CI/Preview, merge, and observe natural production traffic.

## Verification

- Focused Jest and Attendance Playwright while coding.
- PostgreSQL/integration, full Jest, typecheck, lint, build, and `npm run harness:verify` once stable.
- Read-only Vercel/Supabase production reconciliation; no synthetic writes.

## Production safety

- [x] Production mutation not authorized and not used for verification
- [x] Schema/RLS change not applicable
- [x] Read-only audit completed where production state matters
- [x] Secrets and production connections excluded from CI/local tests

## Rollback

Revert the follow-up application commit through a PR. Queue normalization is non-destructive and existing unacknowledged evidence remains durable.

## Decision log

- 2026-08-14: Classified R3 because the Attendance confirmation boundary and foundational offline persistence are in scope.
- 2026-08-14: Late-sync maximum is not part of this incident. Existing date behavior remains unchanged; no policy is invented.

## Progress

- [x] PR #33 merged and exact production deployment verified READY.
- [x] Read-only audit identified the remaining versioning, location, and write-to-read closure gaps.
- [x] Write-to-read closure and role matrix proven in disposable fixtures.
- [x] Implementation and focused verification complete.
- [x] Full local R3 gates pass; PostgreSQL integration is delegated to required CI because this host has no `psql` or Docker.
- [ ] Full R3 release gates and production observation complete.
