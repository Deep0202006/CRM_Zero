# Execution Plan: Distributor Status mapped and Payment Collection certification

## Goal

Certify the current Payment Collection and Distributor Status implementation from production main, repair only proven defects, add explicit Mapped authority, and close renewal/manual/route/read-budget contracts without crossing financial authority.

## Non-goals

- No production migration execution, synthetic production data, financial redesign, fuzzy identity, reminder rows, or polling.
- No Lead, Pipeline, Task, Call, Field Visit, Attendance, Chat, Receivable, or Payment mutation from Distributor commands.

## Current state

Production catalog proves `distributor_accounts` and the 039/040 functions exist, with zero distributor rows and no mapping-equivalent column. Current source hardcodes Distributor readiness, duplicates employee selection logic, and exposes an employee renewal editor whose command route and database function are Admin-only.

## Invariants

- Distributor operational facts remain in `distributor_accounts`; Receivables remains sole money authority.
- Existing Active/Inactive rows remain valid without fabricated mapping; historical mapping stays NULL/unknown.
- Renewal is one canonical `distributor_accounts.renewal_date` fact, visible in Payment Collection and My Day.
- Every list is explicit and bounded; one metrics request serves all cards; no polling.
- Stable operation IDs, expected versions, row locks, receipts, and immutable events protect retries/concurrency.

## Affected domains

Distributor Status, Receivables read integration, renewal/My Day, shared employee authority, route/OS contracts. Protected business domains remain read/write isolated.

## Implementation steps

1. Complete current-main route, readiness, employee, financial, renewal, import, RLS, concurrency, and recent-commit forensics.
2. Add review-only migration 041 with nullable mapping truth, mapped metrics, command/import validation, and assigned-employee renewal authority.
3. Update canonical types/validation/import/manual/list/card UI and share one eligible-employee server capability.
4. Add critical route matrix, empty/error distinction, write-to-read closure, financial/protected write-set, and resource-budget guards.
5. Expand disposable PostgreSQL coverage for RLS, stale writes, import, isolation, and 10k query plans.
6. Run the full R3 ladder, adversarial review, PR, CI, and Preview; stop only at owner SQL application.

## Verification

Focused domain/import/route/renewal/firewall tests; disposable PostgreSQL fresh apply; Distributor and Receivables Playwright; Jest, typecheck, lint, build, harness, required CI, Vercel Preview, and read-only production smoke after owner application/deployment.

## Production safety

- [x] Production mutation is not authorized and will not be used.
- [x] Schema source changes are authorized; production execution is owner-only.
- [x] Read-only production schema/count audit completed.
- [x] Secrets and production connections are excluded from CI/local tests.

## Rollback

Before owner application, abandon/revert the PR. After additive migration, application rollback leaves nullable unused columns and compatible functions; no business data reversal or deletion is required.

## Decision log

- 2026-08-14: Production has zero Distributor Status rows, 039/040 behavior, and no mapping authority. Migration 041 is required; no backfill is permitted.
- 2026-08-14: Existing installation/training activity prerequisites remain unchanged. Mapped is an overlapping projection and does not gate historical Active/Inactive facts.

## Progress

- [x] Current-main and read-only production schema/count audit complete.
- [x] Recent regression, route, readiness, employee authority, Payment, renewal, and import forensics complete.
- [x] Migration/application/tests implemented and specialist findings repaired.
- [ ] Full R3 gates, PR, CI, and Preview complete.
- [ ] Owner migration and production deployment complete.
