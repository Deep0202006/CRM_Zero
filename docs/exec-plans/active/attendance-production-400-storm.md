# Execution Plan: Attendance production 400 storm

## Goal

Identify and stop the rapid Attendance 400 requests still occurring on production deployment `5f857d098ab5eaa387d7feb57d3f3dfd16f07a24`, while preserving authentic queued operations and Attendance write-to-read closure.

## Non-goals

- No late-sync window or other new attendance policy.
- No production test Attendance, queue clearing, history rewrite, or schema migration.
- No Distributor, Payment Collection, Lead, Pipeline, Call, Field Visit, or Chat change.

## Current state

Production SHA `906b9ad375e88f0dbccc06017f7ebae667634fb7` accepts authentic capture-date replay. Natural traffic then produced 7 successful confirms and 10 `LOCATION_REQUIRED` terminal 400s from only two queue-v2 operation IDs. Each terminal item was selected five times because the queue pass did not exclude passive `review_required` evidence, and office auto-attendance trusted potentially stale local capability shape before the server classified the account as field staff.

## Invariants

- `public.attendance` is business authority; selfie/location are evidence.
- Authentic durable operations retain stable ID, identity, capture time, IST date, location, and evidence.
- Terminal failures retain repairable state and never automatically retry; transient failures use bounded backoff.
- Employee, Admin Attendance, and Team KPI resolve the same canonical user/date row.

## Affected domains

Attendance confirmation, durable sync, Attendance readers, and safe production telemetry only.

## Implementation steps

1. Trace every confirm caller and exact terminal/transient state transition on current main.
2. Reproduce each supported and malformed payload class and identify any replay path that bypasses terminal state.
3. Add minimal safe typed route/outbox telemetry and a targeted correction only where proven.
4. Extend compatibility, retry, role-matrix, and write-to-read closure regression coverage.
5. Verify, release through PR/CI, and classify exact-deployment natural traffic.

## Verification

Focused Attendance tests, database/integration tests, E2E, Jest, typecheck, lint, build, harness, CI, Vercel exact-SHA READY, and bounded production log observation.

## Production safety

- [x] Production mutation not authorized and not used
- [x] Schema/RLS impact not applicable
- [x] Production inspection is read-only
- [x] Secrets and production connections excluded from CI/local tests

## Rollback

Revert the narrow product commit through a normal PR. No database or business-data rollback is involved.

## Decision log

- Existing 82 exact-deployment 400s supersede the prior “awaiting natural traffic” state.
- Distributor/Payment work remains isolated in its separate worktree until Attendance is stable.
- Required Attendance CI failed before product assertions because Next 16.2.9 Turbopack's development compiler panicked in its task graph on both Windows and GitHub Linux. The Attendance step alone now runs the already-required, synthetic-environment production build through `next start`, serially. Previously green unrelated browser suites retain their existing development runner.
- Production telemetry proved the remaining storm is `IST_DATE_MISMATCH` for distinct schema-v2 queued operations. The prior route compared capture date to synchronization day; the contract instead validates that `date` equals the IST date derived from immutable `clock_in`, without inventing a replay window.
- Natural production traffic on SHA `906b9ad` proved a second terminal replay path: the loop counted `review_required` as passive but did not skip it during iteration. Browser lifecycle drains therefore reselected terminal `LOCATION_REQUIRED` rows. The affected queue-v2 payloads also prove client role classification must be server-authoritative before office auto-attendance is created.

## Progress

- [x] Incident branch created from exact current main.
- [x] Rapid exact-deployment replay pattern proven; typed reason awaits instrumented production traffic.
- [x] Safe client-contract marker, typed route-stage telemetry, and regression tests complete.
- [x] Local R3 release gate complete (488 Jest; focused role/closure; typecheck; lint; build; harness; Attendance E2E, with one cold-compile timeout passing on exact rerun).
- [x] Production traffic classified: pre-marker schema-v2 queues fail at `business_date` with `IST_DATE_MISMATCH`.
- [x] Authentic capture-date replay correction released; 7 natural 2xx confirmations observed.
- [ ] Passive-state selection, cross-tab serialization, and authoritative office-mode preflight released and naturally certified.
