---
name: zd-receivables
description: Use for ZeroData Payment Collections / Receivables changes.
---
# ZD Receivables

Read `docs/contracts/receivables.md`, `docs/architecture/DATA_AUTHORITY.md`, the R3 manifest/ExecPlan, affected code/tests, and installed Next.js docs.

Protect: PostgreSQL numeric authority; derived balance/state; confirmed-only money; immutable payment/audit history; stable operation IDs and request hashes; expected-version row locks; server-derived actor plus database authorization; assigned-employee isolation; bounded reads/imports; IST alerts; readiness default false.

Never: browser financial mutations, DELETE financial rows, client totals as authority, service-role exposure, offline-confirmed UX, cron reminder rows, or writes/authority from Tasks, Follow-ups, Calls, Field Visits, Pipeline, or Team Chat.

Verify focused money/follow-up/security/concurrency/import/UI/isolation/migration tests, protected suites, full R3 harness, and two-pass adversarial review. Never apply migration or create dummy production money. Handoff must state evidence gaps and owner approval requirements.

