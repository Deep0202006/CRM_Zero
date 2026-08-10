# Calls Contract

## CURRENT

Calls use stable `log_id` values, are retained in Dexie/outbox while pending, confirmed through `/api/call-logs/confirm`, and read through authoritative history when online. Client identity has one canonical interpretation: a valid UUID may be `lead_id`; Excel identities use `client_username`/`client_name` with null `lead_id`; free text uses the exact trimmed value as `client_name` with null `lead_id`.

A newly saved online call receives exact-item priority confirmation by its existing outbox idempotency key. Unrelated backlog drains afterward. Legacy non-UUID `lead_id` payloads are repaired only for remote confirmation, preserve better existing text identity, and reuse the original `log_id`.

## INVARIANT

Never delete call logs or remove an outbox item before exact confirmation. Retry the same ID and idempotency key. Arbitrary text is never a relational UUID. Explicit `user_id` owns the record. Employee counts union unique local/remote IDs; Admin KPI uses unique confirmed IDs. Follow-up attribution remains the canonical completed subset of genuine calls.

## KNOWN DEBT

Offline snapshots are intentionally non-authoritative. Browser-local stranded rows cannot be discovered from remote introspection, so deterministic payload recovery and regression fixtures protect them.

Primary tests: `callLogContract`, `syncPayload`, `callPriorityConfirmation`, `coreReliabilityRelease`, `productionConsistencyGuards`.
