---
name: zd-receivables
description: Use for ZeroData Payment Collections / Receivables changes.
---
# ZD Receivables

Read `docs/contracts/receivables.md`, `docs/architecture/DATA_AUTHORITY.md`, the R3 manifest/ExecPlan, affected code/tests, and installed Next.js docs.

Protect: PostgreSQL numeric authority; derived balance/state; confirmed-only money; immutable payment/audit history; stable operation IDs and request hashes; expected-version row locks; server-derived actor plus database authorization; active non-Admin operational assignees; bounded reads/imports/exports; required initial follow-up; non-future IST payment dates; observable readiness default false. Zero outstanding and pending verification block employee collection commands in DB. Batch preview binds the complete persisted plan; validation uses indexed transaction-local staging before any persistent insert and mutation exceptions roll back. File intake must preserve Unicode/calendar dates, support same-file retry, and use the first meaningful sheet. Export must neutralize formula-capable user text and use IST dates.

Never: browser financial mutations, DELETE financial rows, client totals as authority, service-role exposure, offline-confirmed UX, cron reminder rows, or writes/authority from Tasks, Follow-ups, Calls, Field Visits, Pipeline, or Team Chat.

Verify focused money/follow-up/security/concurrency/import/UI/isolation tests, real browser Admin/employee flows, production-major disposable PostgreSQL migration/RLS/rollback/state-machine/pagination integration, protected suites, full R3 harness, and two-pass adversarial review. Expected constraints must be typed terminal outcomes; unexpected faults remain retryable. Static SQL tests alone are insufficient. Never apply migration or create dummy production money.
