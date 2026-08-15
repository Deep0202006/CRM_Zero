# Execution Plan: Pipeline authority integrity

## Goal

Make Pipeline the single race-safe Lead creation authority, expose every authoritative Lead to every active CRM user/Admin, preserve assigned-owner-only mutation, eliminate false warnings, and certify the current stage contract without changing production evidence.

## Non-goals

- No deletion, merge, rewrite, reassignment, or cleanup of existing Leads, including POOJA records.
- No production fixtures, local-storage/IndexedDB clearing, broad update, old migration replay, or unrelated domain change.
- No fuzzy automatic duplicate merge, Admin mutation override, re-engagement policy, Pipeline rewrite, or speculative index.

## Current state

- Production application and current `origin/main` are `c7ee9fb5d81f2ebc8f49054006e8ddcc52786c9e`; Vercel deployment `dpl_7cyi85QxeZuq5YGPdDnqrkqrajQq` is READY on that exact production SHA.
- Existing contracts say Pipeline is a global bounded read model and assigned-owner-only mutation authority, but the owner reports missing Leads, recreation of a Converted business, and false card warnings.
- Prior Pipeline releases established semantic transitions and disabled cross-domain task/call side effects; this incident must verify current deployed behavior rather than repeat old assumptions.

## Invariants

- Every active authenticated CRM user/Admin reads every Lead, including Converted and unknown historical stages; visibility never grants mutation.
- Only canonical Pipeline Create Lead can insert an authoritative Lead.
- Converted Leads participate in deterministic strong-identity duplicate prevention.
- Create is atomic, race-safe, idempotent, and writes only Lead plus Pipeline audit/idempotency authority.
- Stage changes use the frozen current segment graph, expected version/stage, owner authorization, audit, and typed conflict.
- Calls, Visits, Attendance, Payments, Tasks, Distributor Status, Renewals, My Day, and Onboarding side effects create zero Leads.
- Existing Lead/history/browser evidence is preserved; production investigation and certification are read-only.
- One explicit-column bounded initial request, maximum page 50, no polling, hot `SELECT *`, N+1, or unbounded hydration.

## Affected domains

- Pipeline/Leads: creation, reads, transitions, warnings, offline intents, analytics, UI, and tests.
- Auth/RLS: active-user global read and assigned-owner mutation.
- Supabase: minimum additive/replacement authority objects only if production/source evidence proves necessary.
- Harness/OS: single-entry creation, visibility/ownership/write-set/stage/warning/resource guards.

## Implementation steps

1. Capture read-only production schema, protected counts, stage/type distribution, canonical Mohini identity, all deterministic POOJA matches, events, policies, grants, triggers, and function provenance.
2. Trace every repository/database Lead creation/read/transition/warning path and freeze the actual authority/write graph.
3. Design the minimum coherent correction; prove whether database/RLS/function changes are necessary before allocating the next migration number.
4. Implement canonical idempotent/race-safe creation with deterministic strong identity, Converted-inclusive duplicate detection, global bounded reads, owner-only mutations, typed errors, and warning cleanup.
5. Add disposable PostgreSQL/RLS/role/duplicate/concurrency/write-set/stage/10k tests plus UI/E2E and permanent harness guards.
6. Update the existing Pipeline contract, authority registry/OS lessons, and one concise incident note without duplicating prior history.
7. Run complete R3 verification and adversarial review; resolve all P0/P1 findings; commit, push, open PR, and certify exact-head CI/Preview.
8. If a migration is required, hand off pure PostgreSQL owner precheck/migration/postcheck and stop only at that owner-controlled boundary; otherwise merge and certify exact-main production read-only.

## Verification

- Focused Pipeline Jest/E2E and disposable PostgreSQL 17.6 creation, RLS, visibility, ownership, duplicate, concurrency, idempotency, stage, write-set, and 10k tests.
- Full Jest, typecheck, lint, build, Playwright, harness, owner-SQL guard, GitHub CI, Vercel Preview, exact-main production deployment, and read-only production reconciliation.
- P0 = 0 and P1 = 0 before release.

## Production safety

- [x] Production mutation explicitly authorized or not applicable: not authorized; all investigation/certification is read-only.
- [x] Schema/RLS impact explicitly authorized or not applicable: migration 043 is prepared; owner application remains the only production SQL boundary.
- [x] Read-only audit completed where production state matters.
- [x] Secrets and production connections excluded from CI/local tests.

## Rollback

Before migration, revert the application PR. After an owner-applied authority migration, retain all Lead rows/history and use only a reviewed permission/function rollback; never restore direct unsafe creation or rewrite Lead data. Preserve durable client evidence throughout.

## Decision log

- 2026-08-15: Classified R3 because the incident spans production Lead authority, RLS/permissions, idempotent creation, and possible database-function changes.
- 2026-08-15: Production Lead/POOJA data is forensic evidence and may not be altered; future authority is the first repair target.
- 2026-08-15: Global read and assigned-owner mutation are separate frozen contracts; no Admin override or re-engagement policy will be invented.
- 2026-08-15: Production has 41 Leads, 17 Converted, and one deterministic POOJA match. Two employees and one Admin each read all 41 through the actual authenticated RLS policy; all see all 17 Converted rows.
- 2026-08-15: The surviving POOJA record is Converted and assigned to Mohini. Transition receipts prove its New→Converted path, but no creation receipt existed; exact creator provenance cannot be independently reconstructed beyond the unique current Pipeline generic-insert code path and Cold Call source.
- 2026-08-15: Two production-capable creation paths existed: Pipeline Create and Mapping placeholder materialization. Both converged on generic browser `leads` INSERT, while authenticated direct INSERT remained granted. Migration 043 and the application reduce this to one server command.
- 2026-08-15: No speculative query index is added. The pinned PostgreSQL 17.6 CI workload records EXPLAIN ANALYZE for bounded page, stage, duplicate lookup, and duplicate create at 10k scale.

## Progress

- [x] Clean branch created from exact current `origin/main`.
- [x] Task manifest and active execution plan created.
- [x] Read-only production forensic baseline and authority graph complete.
- [x] Minimum fix implemented with permanent tests/guards.
- [x] R3 gates and P0/P1 review complete.
- [ ] PR exact-head CI/Preview complete.
- [ ] Owner migration or production release/certification complete.
