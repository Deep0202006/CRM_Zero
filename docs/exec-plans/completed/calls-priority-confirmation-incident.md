# Execution Plan: Calls Priority Confirmation Incident

## Goal

Make every newly recorded call immediately durable, correctly encode custom client identity, prioritize exact online confirmation, and recover compatible stranded calls without duplicates or deletion.

## Non-goals

No schema/RLS/auth/API-shape change, production mutation, historical confirmed-row normalization, follow-up semantic change, field-visit change, or Unique Completed Work change.

## Current state

Free-text non-EXCEL client references became non-UUID `lead_id` values rejected by the server. General FIFO queue draining placed a new call behind unrelated failed work.

## Invariants

Stable `log_id`; zero deletion; explicit owner; exact server confirmation before queue removal; offline visibility; canonical IST unique-ID counts; same durable outbox; unchanged follow-up subset/accounting.

## Affected domains

Calls is primary. Follow-ups and Team KPI are protected downstream consumers verified by regression tests.

## Implementation steps

1. Perform aggregate-only read-only production audit.
2. Trace client-reference parsing, durable transaction, queue payload preparation, confirmation, UI refresh, and KPI attribution.
3. Canonicalize known UUID, Excel, and free-text identities at creation and remote payload preparation.
4. Add an exact-call priority confirmation operation integrated with the existing outbox.
5. Update local UI from the durable record and refresh authority asynchronously.
6. Add incident regression/performance/recovery tests and OS lesson.

## Verification

Harness self-tests 7/7; related tests 45/45; full Jest 34 suites and 231 tests; typecheck, lint, build, scope, invariant, docs, and diff checks passed.

## Production safety

- [x] Production audit was read-only and aggregate-only.
- [x] No production mutation was authorized or performed.
- [x] No schema/RLS/migration change.
- [x] No customer data or credentials entered repository artifacts.

## Rollback

Revert the incident commits. Existing local queue entries remain durable and retryable because IDs and storage contracts are unchanged.

## Decision log

- R2: critical call synchronization changes without schema/auth/production mutation.
- Preserved the existing confirmation route and outbox; added targeted selection rather than a second sync system.
- Re-planned `src/lib/syncPayload.ts` explicitly because it is the existing compatibility boundary for stranded outbox payloads.
- Re-planned the R3 negative self-test and verifier to isolate active-plan fixtures after the incident plan exposed repository-state coupling.
- Adversarial review preserved focus retries and excluded the just-attempted call from the one background backlog pass.

## Progress

- [x] Incident classified and scoped.
- [x] Production audit complete.
- [x] Implementation complete.
- [x] Verification complete.
- [x] Released through PR #15.
