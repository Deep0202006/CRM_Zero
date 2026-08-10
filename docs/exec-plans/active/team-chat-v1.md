# Execution Plan: Team Chat V1

## Goal

Deliver a simple authenticated Team room and one-to-one employee chat with authoritative Supabase history, unread state, secure low-latency updates, and explicit opt-in Web Push.

## Non-goals

No editing, deletion, attachments, reactions, GIFs, threads, voice/video, complex channels, external users, production data creation, or production migration application. Reliable offline send is deferred; Send is disabled while offline.

## Current state

The CRM has Supabase identities, server-authoritative APIs, authenticated navigation, design primitives, and Realtime usage, but no chat domain, message tables, push subscription storage, or service worker.

## Invariants

- Stable conversation/message IDs; immutable V1 message bodies.
- Database/API reads remain authority; Realtime is only a refetch signal.
- Membership gates every conversation read, message read/send, read-state update, and private subscription.
- Sender is derived from the authenticated session; client `sender_id` is never trusted.
- Admin capability does not grant private-DM access.
- No DELETE/edit product path and no production test writes.
- Push secrets are server-only; sender gets no own push; notification content is privacy-preserving.

## Affected domains

Team Chat, Auth boundary, Supabase/RLS, shared navigation/UI.

## Implementation steps

1. Inspect current auth/API/navigation patterns and current Supabase Realtime recommendations.
2. Define the team-chat contract and smallest additive schema/RLS/functions/indexes.
3. Implement server-only authorization helpers and bounded conversation/message/read/send/DM/subscription endpoints.
4. Implement responsive chat UI, Realtime-triggered reconciliation, unread state, explicit notification opt-in, and service-worker deep links.
5. Add domain config, scoped skill, architecture docs, migration review/rollout docs, guards, and mocked/static contract tests.
6. Run R3 gates and adversarial security review; push branch and open preview PR without applying SQL.

## Verification

- Focused team-chat tests with mocked/local fixtures only.
- Harness self-tests, scope, invariant, docs checks.
- Full Jest, typecheck, lint, and production build.
- Static migration/RLS security assertions and manual source review for membership leakage, sender forgery, pagination bounds, secret exposure, deletes/edits, notification duplication, and reconnect deduplication.

## Production safety

- [x] Production mutation explicitly authorized or not applicable — not authorized; no production mutation will occur.
- [ ] Schema/RLS impact explicitly authorized or not applicable — design/commit authorized; production application requires a separate owner approval.
- [x] Read-only audit completed where production state matters — existing identities/auth patterns inspected; local migrations are not treated as production proof.
- [x] Secrets and production connections excluded from CI/local tests.

## Rollback

Before migration approval: revert the feature branch/PR. After a separately authorized rollout: disable navigation/API exposure first; retain immutable chat rows and subscriptions unless a separate owner-approved data-retention action exists. No destructive rollback is bundled.

## Decision log

- 2026-08-10: R3 because additive tables, RLS, functions, Realtime publication, and push subscription persistence are proposed.
- 2026-08-10: Defer offline send; disable Send offline.
- 2026-08-10: Use database-triggered private Broadcast as a low-latency signal plus authoritative API refetch; no message body is broadcast.

## Progress

- [x] Safety gate, branch, manifest, and ExecPlan created.
- [x] Architecture and migration reviewed.
- [x] APIs and UI implemented.
- [x] Tests and harness integration complete.
- [x] Security/adversarial review complete.
- [ ] PR checks and preview complete.
