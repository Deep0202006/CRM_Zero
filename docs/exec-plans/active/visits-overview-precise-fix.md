# Execution Plan: Visits Overview precise fix

## Goal

Open Visits Overview on complete retained history, keep the two main charts, seven outcome cards, register, and export on one confirmed filter scope, and simplify direct controls and record details without changing visit authority.

## Non-goals

- No changes to visit capture, confirmation, sync, My Day, Team KPI, Pipeline, financial calculations, or ERP authority.
- No production data mutation, migration application, polling, dependency, chart type, index, or shared rail CSS change.

## Current state

`initialVisitQuery()` selects the last seven IST days. The analysis route downloads capped raw events and accepts at most 31 days. Register and export v1 readers also reject lifetime and wider ranges. The page requires a nested disclosure and Apply action before charts load.

## Invariants

- `field_visits` remains the only Visit authority; all additions are read-only derived projections.
- Ordinary date filtering uses canonical `visit_date`; legacy compatibility remains explicit.
- One aggregate response supplies totals, outcomes, and time buckets and reconciles exactly.
- Register stays at 50 rows per page and export keeps its row, byte, request, and deadline limits.
- Authorization remains active-admin server-side; new function execution is service-role only.
- Empty, unavailable, activation-pending, and stale confirmed scopes remain distinct.

## Affected domains

- Field Visits retained-history reads and export.
- Visits Overview presentation only.

## Implementation steps

1. Add versioned TypeScript scope and summary schemas with exact reconciliation checks.
2. Add one additive Owner-manual migration with bounded summary, register v2, and export v2 readers plus precheck/postcheck.
3. Move analysis/register/export routes to the new readers while preserving auth, cancellation, response, and workbook budgets.
4. Make the mounted page use intended and confirmed query snapshots, immediate controls, lifetime defaults, shared summaries, and compact detail groups.
5. Extend registered SQL/HTTP/unit/browser proofs and update affected contracts.

## Verification

- Focused field-visit unit and browser tests.
- Disposable PostgreSQL and HTTP proof for aggregate reconciliation, security grants, wide/lifetime ranges, and compatibility.
- Typecheck, lint, build, impact compilation, proof planning, and registered exact-head gates.

## Production safety

- [x] Production mutation not authorized and not performed.
- [x] Schema change is additive, proposed, and Owner-manual only.
- [x] Existing read-only production observations are recorded in the approved handoff; no new production contact is required for implementation.
- [x] CI/local tests use synthetic data and exclude secrets and production connections.

## Rollback

Revert the application to the prior compatible release. Preserve all Visit rows and the v1 readers; no destructive SQL rollback is required.

## Decision log

- 2026-09-21: Classified R3 because the implementation adds database functions and grants even though it does not mutate business data or RLS.
- 2026-09-21: Reuse the established `crm_visit_matches_v1` predicate and v1 projections; add v2 readers rather than weakening deployed v1 contracts.

## Progress

- [x] Exact baseline, clean managed worktree, contracts, Next.js route guide, task authority, and root cause verified.
- [x] Implement additive readers and TypeScript contracts.
- [x] Integrate routes and UI.
- [ ] Complete disposable PostgreSQL/HTTP and exact-head browser proofs in CI; focused local unit/browser, typecheck, lint, and build pass.
- [x] Review final diff and verify the Owner SQL packet hashes.
- [ ] Run required exact-head gates in CI.
