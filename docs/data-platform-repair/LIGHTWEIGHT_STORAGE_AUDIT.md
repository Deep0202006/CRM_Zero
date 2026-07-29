# Lightweight local storage audit

Date: 2026-07-29. This audit inspected schema and retention code only. No employee or customer records were read or printed.

## IndexedDB

`CRMDatabase` has 14 forward-only Dexie versions. Versions 1–13 preserve the historical schema; version 14 converts legacy visit-media data URIs to structured-clone `Blob` values. Supabase remains authoritative for confirmed business rows. IndexedDB is a recent user cache plus durable outbox and temporary evidence.

Sizes below are engineering estimates for ordinary JSON records, excluding unusual free text. Actual metadata is available on Data Health without exposing record content.

| Table | Record | Class | Estimate | Retention / safe cleanup | Pending dependency | Cross-device authority | Growth risk |
|---|---|---|---:|---|---|---|---|
| users | user directory row | cache | 0.5–1 KB | visible active directory; no automated prune | auth/bootstrap | Supabase `users` | low |
| capabilities | capability definition | cache | <0.5 KB | current definitions | auth | Supabase | low |
| user_capabilities | assignment | cache | <0.5 KB | current assignments | auth | Supabase | low |
| leads | operational lead | cache | 1–3 KB | current accessible leads; no history expansion | many commands reference IDs | Supabase `leads` | medium |
| client_queries | support query | cache | 1–4 KB | all open; confirmed resolved rows for 90 days | query resolution queue | Supabase | high before repair |
| mappings | completed mapping | cache | 0.5–1 KB | active/recent; confirmed completion older than 90 days may prune | mapping command | Supabase | medium |
| mapping_requests | mapping work | cache | 0.5–1 KB | all pending; confirmed completed for 90 days | mapping command | Supabase | medium |
| internal_tickets | internal support work | cache | 1–4 KB | current behavior retained; not auto-pruned in this task | ticket command | Supabase | medium |
| attendance | attendance record | cache | 0.5–2 KB | current behavior retained | attendance command | Supabase | medium |
| call_logs | call activity | cache | 0.5–2 KB | confirmed rows for 90 days | call command | Supabase | high before repair |
| sync_queue | command, identifiers, minimal arguments | permanent until confirmed | 1–5 KB | delete only after authenticated server confirmation | is the durable dependency | command receipts / business table | bounded by work; failures intentionally retained |
| task_templates | task definition | cache | 0.5–2 KB | active definitions | task creation | Supabase | low |
| tasks | assigned task | cache | 1–4 KB | all open; confirmed completed for 90 days | task command | Supabase | high before repair |
| task_status_history | task transition | cache | 0.3–1 KB | bootstrap already restricted to 90 days | task commands | Supabase | medium |
| kpi_snapshots | derived KPI row | cache | 0.5–1 KB | existing projection behavior | none | server projection/event ledger | medium |
| lead_registration_checklist | onboarding state | cache | <1 KB | current operational state | lead command | Supabase | low |
| lead_installation_details | installation state | cache | 1–3 KB | current operational state | lead command | Supabase | medium |
| lead_payment_details | payment state | cache | <1 KB | current operational state | lead command | Supabase | medium |
| field_visits | visit metadata | cache | 1–3 KB | confirmed visits for 90 days | visit command and media | Supabase | high before repair |
| field_visit_media | compressed evidence `Blob` | temporary | target ≤350 KB | remove only after visit command returns confirmed row | required by pending/retry/permanent visit | private Supabase Storage object | high but capped at 25 MB pending |
| task_upload_batches | upload metadata, not spreadsheet | cache | <1 KB | current behavior retained | target commands | Supabase | low |
| allocated_targets | allocated target | cache | 1–4 KB | all active; confirmed completed for 90 days | completion command | Supabase | high before repair |

## Other browser storage

| Store | Content | Retention and risk |
|---|---|---|
| Bootstrap markers | per-user table completion timestamps | tiny; overwritten by later bootstrap |
| Local/session storage diagnostics | cleanup/bootstrap timestamps and auth identifier | metadata only; diagnostic budget is 5 MB and retention policy is 7 days |
| Browser quota estimate | browser-provided usage/quota metadata | supporting signal only; never expands application budgets |

There is no separate React Query cache. “Queries cache” means the `client_queries` Dexie table. Calls, mappings, tasks, targets, and visits are likewise Dexie caches.

## Existing and repaired cleanup

Before this repair, bootstrap limited remote reads to 90 days but did not remove older cached rows, so long-lived devices could grow without bound. Confirmed visit media was already deleted after a successful visit command, but was stored as Base64 first.

The cleanup service now requires a `cache_confirmed_at` proof written only by server bootstrap, authenticated command confirmation, or Realtime. It additionally requires an old completed timestamp, correct user ownership, no outbox reference, no local mutation flag, and no unresolved conflict. It uses a module mutex, batches of 100, browser yields, and one normal run per session. The hard limit never authorizes deleting unconfirmed work.

## Development storage

Playwright trace and video are retained only on failure. `test-results`, `playwright-report`, and `blob-report` are ignored. `.codex-artifacts` is ignored, has a 7-day retention policy and a 200 MB warning budget. At audit time there were two worktrees, matching the maximum. `node_modules` is reported informationally and never auto-deleted. The repository already ignores repair ZIP patterns; the storage reporter rejects tracked archive/dump formats.
