# Execution Plan: Field Visits confirm 400 incident

## Goal

Classify the live `/api/field-visits/confirm` HTTP 400 sequence, stop terminal replay, and preserve authentic queued visit evidence for review or compatible recovery.

## Non-goals

- No production data mutation, migration, history rewrite, or fabricated visit.
- No change to Attendance, Calls, Pipeline, Tasks, Leads, Distributor, or financial authority.
- No invented age limit for authentic queued visits.

## Current state

Production emitted 24 HTTP 400 responses in clustered bursts. Runtime logs contain the route/status but not the typed response body. The client currently selects every `sync_failed` visit on auth, online, visibility, and page recovery drains.

## Invariants

- Stable `visit_id`, owner, original capture timestamp, IST date, address, location, and selfie evidence are preserved.
- Confirmed visits are never undone by evidence failure.
- Terminal 4xx receives zero automatic retries and remains `review_required`.
- Network, 408, 429, and 5xx retries are bounded and back off.
- Server response codes are safe and observable without payload or identity logging.

## Affected domains

Field Visits only.

## Implementation steps

1. Trace durable payload, serializer, confirm validation, DB/evidence write, and retry triggers.
2. Add safe typed rejection observability and terminal/transient classification.
3. Add durable review state and bounded transient retry scheduling.
4. Add current and historical payload regression fixtures and UI state coverage.
5. Run focused, harness, and full R3 gates; release separately from PR #40.

## Verification

- Unit tests for 400, 408, 429, 5xx, network, retry exhaustion, and manual/current submission.
- Existing Field Visits lifecycle/E2E and cross-domain guards.
- `npm run harness:verify` and required R3 CI.

## Production safety

- [x] Production mutation explicitly unauthorized
- [x] Schema/RLS impact not applicable
- [x] Read-only audit completed where production state matters
- [x] Secrets and production connections excluded from CI/local tests

## Rollback

Revert the isolated Field Visits incident PR. Durable local rows and media remain intact throughout.

## Decision log

- The retry storm is proven independently of the underlying validation subtype: `sync_failed` is always selected again.
- Production logs do not contain response bodies, so no specific validation field will be guessed.
- Existing server semantics permit authentic recovery without inventing a late-sync window.

## Progress

- [x] Production request clustering and retry path traced
- [x] Terminal/transient classifier implemented
- [x] Compatibility tests green
- [x] Full local R3 verification green
- [ ] Exact live typed rejection classified from safe observability
- [ ] Separate PR certified
