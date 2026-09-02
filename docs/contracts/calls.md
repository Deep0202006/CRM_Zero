# Calls Contract

## CURRENT

Calls use stable `log_id` values, are retained in Dexie/outbox while pending, confirmed through `/api/call-logs/confirm`, and read through authoritative history when online. Client identity has one canonical interpretation: a valid UUID may be `lead_id`; non-lead directory identities require both `client_username` and `client_name` with null `lead_id`. An incomplete retained legacy reference is preserved for review and is not automatically replayed forever.

A newly saved online call receives exact-item priority confirmation by its existing outbox idempotency key. Unrelated backlog drains afterward. Legacy non-UUID `lead_id` payloads are repaired only for remote confirmation, preserve better existing text identity, and reuse the original `log_id`. The authenticated creator may later edit the exact Call business facts through `/api/call-logs/[log_id]`; no Admin override exists.

## INVARIANT

Never delete call logs or remove an outbox item before exact confirmation. Retry the same ID and idempotency key. Arbitrary text is never a relational UUID. `call_logs.user_id` is the immutable creator and sole update authority; Admin read visibility is not write authority. `log_id`, `user_id`, and the original timestamp are immutable. `outcome` remains the single Call response/status fact. Employee counts union unique local/remote IDs; Admin KPI uses unique confirmed IDs. Follow-up attribution remains the canonical completed subset of genuine calls.

An explicit Pipeline Log Call handoff carries the exact Lead UUID through the canonical client-reference parser. The ordinary directory-client and standalone Call flows remain unchanged, and the existing Call UUID/outbox/idempotency path remains the only write path.

Authoritative call-history availability must not depend on unrelated KPI/task enrichment. Optional metric failure may explicitly degrade today's derived metrics, but cannot hide successfully retrieved confirmed call rows. Online history merges server-confirmed rows with the current user's durable pending insert or update by `log_id`; the pending owner edit wins display precedence until its exact server update confirms.

Pending Call edits rewrite the existing `call-log:<log_id>` INSERT payload. Confirmed edits use one coalesced `call-update:<log_id>` semantic UPDATE. Both retain the same logical Call and local row. A terminal ownership, validation, missing-row, or synthetic-audit denial is retained as review-required recovery state instead of retrying forever. Follow-up reconciliation updates one active source-linked intent, deactivates obsolete active intent without deletion, and preserves completed history.

## CHANGE BUDGET

DATA AUTHORITY: `public.call_logs`; source-linked Tasks remain Task authority. READ BUDGET: authoritative history remains paginated at 50 rows. WRITE BUDGET: one exact Call row plus only necessary source-linked Task upserts; zero deletes. RLS MODEL: active creator-only UPDATE, Admin SELECT remains separate. INDEX REQUIREMENTS: existing `log_id` and owner indexes; no new index without a measured plan. FAILURE MODE: durable pending/review-required queue state. CONCURRENCY MODEL: stable-ID latest queued creator edit wins. IDEMPOTENCY MODEL: stable insert/update queue keys and exact `log_id`. TEST PLAN: owner route, RLS, pending/confirmed queue, follow-up, metrics, and E2E matrices.

Paginated history length is not lifetime history count. When online, lifetime call-history totals come from authoritative server count metadata scoped to the authenticated owner; page size and browser cache size must never define the displayed lifetime total. Pending local calls and device-only fallback rows remain explicitly separate from that confirmed total.

## KNOWN DEBT

Offline snapshots are intentionally non-authoritative and degraded authoritative reads must be visible rather than presented as complete empty history. Browser-local stranded rows cannot be discovered from remote introspection, so deterministic payload recovery and regression fixtures protect them. A legacy free-text call with no stable username cannot be safely fabricated into a production directory identity; it remains durable review-required evidence.

Primary tests: `callLogContract`, `callOwnerUpdate`, `callHistoryAuthority`, `syncPayload`, `callPriorityConfirmation`, `followUpContract`, `coreReliabilityRelease`, `product-054-postgres`, and Call Logs E2E.
