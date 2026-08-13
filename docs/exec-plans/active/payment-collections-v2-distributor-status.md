# Execution Plan: Payment Collections V2 — Distributor Status and Renewals

## Goal

Add a canonical distributor lifecycle authority beneath Payment Collections, including orthogonal operational status, renewal history/reminders, bounded Admin and employee read models, safe manual/import mutations, and Receivables display integration.

## Non-goals

- No production migration execution or synthetic production data.
- No financial, Pipeline, Task, Call, Field Visit, Attendance, or Chat mutation.
- No fuzzy identity merge, customer messaging, cron reminder rows, or subscription engine.

## Current state

Receivables owns financial authority and has hardened import/idempotency primitives. Distributor leads and Receivables carry references but no verified distributor-level lifecycle/renewal aggregate exists. Migration numbering ends at 038; 039 is reserved for this additive feature.

## Invariants

- One internal distributor ID owns current operational and renewal facts.
- Receivables remains the only payment/balance authority.
- Status dimensions are independent facts with database validation.
- Renewal reminders are derived from PostgreSQL DATE using IST semantics.
- Mutations are Admin-only, idempotent, expected-version checked, audited, and isolated.
- Reads are explicit, paginated, non-binary, and non-polling.

## Affected domains

Primary: distributor-status. Integrations: Payment Collections navigation/read models and My Day. Protected: Receivables money/payments, Pipeline, Tasks, Calls, Field Visits, Attendance, and Chat.

## Implementation steps

1. Audit identity, schema, routes, imports, navigation, My Day, and IST helpers once.
2. Freeze distributor-status contract and exact additive migration/RLS/RPC design.
3. Add domain types, validation, renewal resolver, server authorization, bounded reads, and versioned commands.
4. Add Admin dashboard/manual/import/detail/history and employee assigned/read-reminder surfaces.
5. Integrate renewal projection into Payment Collections and existing My Day response.
6. Add PostgreSQL, unit, import, concurrency, isolation, scale, and responsive E2E coverage.
7. Evolve only relevant OS contracts/guards, run two adversarial passes, and complete R3 gates.
8. Commit, open PR, obtain CI/preview, then stop for owner migration.

## Verification

Focused domain/import/IST/security/isolation tests; exact PostgreSQL 17.6 migration/RLS/concurrency/scale tests; desktop/tablet/mobile E2E; Jest; typecheck; lint; build; harness; CI; Vercel Preview.

## Production safety

- [x] Production mutation is not authorized.
- [x] Schema/RLS source changes are authorized; execution is owner-only.
- [ ] Read-only production compatibility audit completed where needed.
- [x] Secrets and production connections excluded from CI/local tests.

## Rollback

Application remains fail-closed until schema readiness is enabled. Roll back application deployment if needed; preserve additive distributor/history rows. Database rollback requires owner review and must not delete business history.

## Decision log

- 2026-08-13: R3; additive migration 039 source only.
- 2026-08-13: Distributor lifecycle owns renewal and operational status; Receivables only links/reads.
- 2026-08-13: Derived renewal reminders; no generated work rows or polling.

## Progress

- [x] Branch, R3 manifest, and active plan created.
- [x] Focused audit and contract freeze.
- [x] Implementation and focused application verification.
- [x] Data/authority and product/performance adversarial source passes; local P0/P1=0.
- [ ] Disposable PostgreSQL 17.6 runtime, PR CI/Preview, and owner handoff.

Local evidence: 18 focused tests, 140 related tests, 465 full Jest tests, 4 Chromium responsive flows, typecheck, lint (0 errors), build, scope, invariant guard, docs, and R3 harness pass. PostgreSQL/Docker are unavailable locally; exact fresh-apply, RLS, atomic import, concurrency, isolation, EXPLAIN, and 10,000-row runtime suite is wired into CI and remains mandatory.
