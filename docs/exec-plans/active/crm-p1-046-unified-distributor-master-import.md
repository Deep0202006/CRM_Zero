# Execution Plan: CRM-P1-046 Unified Distributor Master Import

## Goal

Provide one bounded XLSX intake that previews and atomically orchestrates canonical Distributor Status, renewal, Receivable, and historical confirmed Payment authorities.

## Non-goals

- No new financial-status authority or writable Paid field.
- No fuzzy distributor identity, deletion, cancellation, reversal, or production test data.
- No changes to migrations 001–045 or direct production migration execution by Codex.

## Current state

Distributor identity and renewal are owned by `distributor_accounts`; bills by `receivables`; confirmed payment events by `receivable_payments`; collection state is derived. Existing single-domain imports remain available.

## Invariants

- Distributor Reference resolves case-insensitively and names never resolve identity.
- Existing blank Distributor cells mean no change; `[CLEAR]` is limited to supported nullable fields.
- Preview is write-free and confirmation re-resolves the complete plan.
- Confirmation commits every planned authority mutation in one PostgreSQL transaction or none.
- Payment import keys are unique per exact Receivable and each payment remains a separate event.

## Affected domains

Distributor Status, renewal, Receivables, payment collections, imports, Admin Distributor Collections UI, and service-only orchestration metadata.

## Implementation steps

1. Parse and generate the exact bounded four-sheet workbook contract.
2. Resolve canonical employees, distributors, receivables, and payment import keys in bounded set reads.
3. Build a complete before/action/after plan and hash the resolved authority plan.
4. Add Migration 046 payment idempotency and service-only atomic orchestration.
5. Add one Admin preview/confirmation workflow while preserving legacy imports.
6. Persist Graph lessons and owner migration evidence.

## Verification

Focused parser/planner/API/UI tests; Distributor E2E; disposable PostgreSQL 17.6 fresh apply, idempotency, concurrency, and rollback; typecheck; scoped lint; production build; Graph proof; exact-head CI and Vercel Preview.

## Production safety

- [x] Production mutation not authorized; Codex remains read-only.
- [x] Additive schema/RLS change explicitly authorized as Migration 046.
- [ ] Read-only production precheck completed before owner handoff.
- [x] Secrets and production connections excluded from CI/local tests.

## Rollback

Before owner application, close the feature PR. After owner application, use a reviewed forward migration to revoke/drop only Migration 046 service entry points and orchestration metadata; preserve payment events and never edit Migration 046 in place.

## Decision log

- XLSX is the canonical multi-sheet format; CSV is rejected and existing single-domain import remains available.
- Existing authority functions are invoked inside one outer transaction.
- Fully settled imported bills receive transaction-local follow-up compatibility only until the confirmed payment event clears follow-up canonically.
- Local PostgreSQL is ephemeral proof tooling; GitHub Actions PostgreSQL 17.6 is release authority.

## Progress

- [x] Worktree, branch, Graph task, and context bound to exact base.
- [x] Workbook, preview, API, UI, Migration 046, and focused tests implemented.
- [x] Focused local disposable database proof completed and runtime stopped.
- [x] Focused verification and owner artifacts complete; Graph entered OWNER_PRODUCTION_GATE.
- [ ] Exact-head PR CI and Vercel Preview.
- [ ] Owner manually applies Migration 046; read-only postcheck and release resume afterward.
