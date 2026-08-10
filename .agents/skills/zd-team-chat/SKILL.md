---
name: zd-team-chat
description: Use for Team Chat messages, membership, unread state, realtime delivery, or browser push notifications.
---

# ZD Team Chat

## Required inputs

- Desired chat outcome and risk classification.
- Affected conversation, authorization, realtime, or notification surface.

## Workflow

1. Read `docs/contracts/team-chat.md` and only the relevant source/tests.
2. For schema or RLS work, follow `supabase/AGENTS.md`, create an ExecPlan, and stop before applying production migrations without owner approval.
3. Keep database/API reads authoritative; treat Realtime as a reconciliation signal.
4. Verify membership on every private operation and derive sender identity from the authenticated session.
5. Use mocked/local fixtures only; never create production chat data for testing.

## Relevant repository docs

- `docs/contracts/team-chat.md`
- `docs/architecture/DOMAIN_BOUNDARIES.md`
- `docs/architecture/CRITICAL_FLOWS.md`
- `docs/os/RISK_MODEL.md`
- `docs/os/RELEASE_PROTOCOL.md`

## Required checks

- Stable IDs, bounded history, reconnect deduplication, unread reconciliation.
- No message edit/delete path and no admin private-DM bypass.
- Push secret isolation, explicit permission request, private notification text, sender exclusion.
- R3 harness verification and migration review.

## Output contract

Report scope, authorization model, migration status, mocked test results, security findings, and the exact approval still required.
