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
- Online critical success requires exact server confirmation.
- Pending work remains recoverable after network, response, reload, or optional-schema failure.
- Follow-up completion derives from confirmed source work; it is not fabricated.
- Team KPI validates totals, unique users, target date, and explicit attribution.
- Privileged authorization is checked on the server; client role claims are insufficient.
- Local migrations are evidence, never proof of production schema.

## CURRENT

These principles are derived from current contract modules, confirmation routes, sync logic, and regression tests.

## KNOWN DEBT

Not every semantic invariant can be mechanically detected; focused regression tests remain essential.
