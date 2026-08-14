# Execution Plan: Attendance confirmation contract recovery

## Goal

Recover current and legacy queued Attendance confirmations without data loss, and prevent deterministic 4xx confirmation failures from being replayed.

## Non-goals

No schema migration, production mutation, Distributor Status change, media retention redesign, or browser-state clearing.

## Current state

The deployed client queues `selfie_captured` while the route's strict schema rejects it. The rejection is `ATTENDANCE_VALIDATION_FAILED` (HTTP 400). The current queue marks this state review-required, but it cannot deterministically repair this safe metadata mismatch.

## Invariants

- Attendance rows are authority; evidence lifecycle never changes presence.
- Stable `attendance_id` is retained for retries.
- Queue evidence, identity, location, timestamps, and operation key are never deleted by recovery.
- Only transport failures, 408, 429, and 5xx retry automatically.

## Affected domains

Attendance confirmation route, durable browser outbox, legacy payload compatibility, contract tests, and lessons ledger.

## Implementation steps

1. Normalize presentation/evidence metadata from queued Attendance payloads before canonical route validation.
2. Make the route accept the compatibility metadata while retaining a strict business payload allow-list.
3. Add executable regression coverage for current and legacy queue payloads and terminal 400 behavior.
4. Update the lesson ledger and generated repository map required by the documentation gate.

## Verification

- Focused Jest attendance tests.
- Typecheck, lint, build, harness verification according to R3.
- Static route/outbox contract tests show no destructive or cross-domain operation.

## Production safety

- [x] Production mutation explicitly not applicable
- [x] Schema/RLS impact explicitly not applicable
- [x] Read-only audit completed where production state matters
- [x] Secrets and production connections excluded from CI/local tests

## Rollback

Revert the single feature-branch commit. Existing queue rows remain durable and unchanged apart from deterministic payload normalization performed only at sync attempt time.

## Decision log

- Rejecting extra client-only evidence metadata was the exact contract incompatibility.
- Compatibility is handled at the existing outbox and route boundary; no second retry system or server-side data repair is introduced.

## Progress

- [x] Root cause traced and confirmed.
- [x] Implemented deterministic outbox and route compatibility recovery.
- [x] Focused and full Jest, typecheck, build, scope, invariant, and documentation checks passed.
- [ ] CI and production natural-traffic observation pending PR/merge.
