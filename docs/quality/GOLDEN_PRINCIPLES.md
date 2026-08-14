# Golden Principles

## INVARIANT

- Never delete `call_logs`.
- Never delete `field_visits`.
- Never clear browser databases or local durable recovery tables.
- Business IDs are stable; retry reuses the same ID.
- Never fabricate production records.
- Supabase-confirmed rows are cross-device authority.
- IndexedDB is durable local/offline recovery state.
- Service-role secrets are server-only.
- Critical calls use the approved confirmation API.
- Critical field visits use the approved confirmation API.
- Evidence failure cannot block or undo a confirmed visit.
- Shared IST helpers own India business-date logic.
- Employee ownership is explicit and user-scoped.
- Unknown records are preserved instead of guessed.
- Admin reporting is server-authoritative.
- One business concept has one authority; cross-domain displays never become duplicate truth.
- Define an incident as user-observed failure, expected authority, write path, read path, and acceptance invariant before implementation; unrelated policy cannot block the incident.
- A successful important write is not certified until every authoritative reader converges for every distinct authorized role shape.
- Never invent business policy to close a bug when the current contract already defines the requested flow.
- Store orthogonal facts when product categories overlap; derive dashboard cards.
- Every mutation declares an exact side-effect budget and every major screen a read budget.
- Derived date alerts do not create generated work unless explicitly approved.
- Admin import preview is not authority; commit revalidates, is idempotent, atomic, and never fuzzy-merges.
- Important mutable aggregates require stale-write protection and cross-domain isolation tests.
- Hot lists are explicit and bounded; binary/base64 business hydration is forbidden.
- Authoritative business history is never lossily compressed or overwritten without audit.
- Online critical success requires exact server confirmation.
- Pending work remains recoverable after network, response, reload, or optional-schema failure.
- Follow-up completion derives from confirmed source work; it is not fabricated.
- Team KPI validates totals, unique users, target date, and explicit attribution.
- Privileged authorization is checked on the server; client role claims are insufficient.
- Local migrations are evidence, never proof of production schema.
- Automated tests, QA fixtures, and smoke tests never create dummy/test business data in live production Supabase. Production verification is read-only by default. Testing may not insert, update, or delete users, leads, calls, visits, tasks, attendance, queries, mappings, chat/messages, or other business records without the owner explicitly authorizing that exact mutation.
- Never use “insert dummy data → test → delete dummy data” in production. Use mocks, fixtures, isolated local tests, preview environments, and read-only production reconciliation.

## CURRENT

These principles are derived from current contract modules, confirmation routes, sync logic, and regression tests.
Required main CI stays green; production releases use a clean branch, PR, required CI, merge, and exact-SHA deployment verification.

## KNOWN DEBT

Not every semantic invariant can be mechanically detected; focused regression tests remain essential.
