---
name: zd-receivables
description: Use for ZeroData Payment Collections / Receivables changes.
---
# ZD Receivables

Read `docs/contracts/receivables.md`, `docs/architecture/DATA_AUTHORITY.md`, the R3 manifest/ExecPlan, affected code/tests, and installed Next.js docs.

Protect: PostgreSQL numeric authority; derived balance/state; confirmed-only money; immutable payment/audit history; stable operation IDs and request hashes; expected-version row locks; server-derived actor plus database authorization; assigned-employee isolation; bounded reads/imports; required initial follow-up; non-future IST payment dates; readiness default false. Batch import must finish its write-free validation phase before any insert; mutation-phase exceptions must roll back.

Never: browser financial mutations, DELETE financial rows, client totals as authority, service-role exposure, offline-confirmed UX, cron reminder rows, or writes/authority from Tasks, Follow-ups, Calls, Field Visits, Pipeline, or Team Chat.

Verify focused money/follow-up/security/concurrency/import/UI/isolation tests, disposable PostgreSQL migration/RLS/rollback/concurrency integration, protected suites, full R3 harness, and two-pass adversarial review. Static SQL tests alone are insufficient. Never apply migration or create dummy production money. Handoff must state evidence gaps and owner approval requirements.
