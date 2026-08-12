# Pipeline Authority and Resource Budget

## Goal

Make Pipeline a bounded global read model with assigned-owner-only actions, segment-specific stages, no cross-domain write side effects, and durable Free-plan resource budgets.

## Non-goals

- No production migration execution, production fixture creation, lead deletion, financial change, or unrelated CRM redesign.

## Current state

- Deployed Pipeline triggers create follow-up and registration tasks; broad policies permit Admin mutation; Retailer Payment has 13 rows; legacy cron jobs bypass transition authority.

## Invariants

- No lead deletion, ID rewrite, production dummy data, or browser recovery-state clearing.
- Retailer Payment alone is corrected to Converted; every non-target lead state is preserved.
- Distributor Payment remains valid.
- Pipeline transition writes only Lead state and transition audit/idempotency.
- Calls never create Leads or Pipeline transitions.
- Admin normal action requires assignment; reassignment remains separate.
- Production work is read-only; owner applies migration 037.

## Affected domains

- Pipeline, Tasks/My Day active-work projection, authentication/RLS, Calls isolation, Supabase migrations, and Engineering OS resource budgets.

## Production audit

- Start main: `cbbace3e06f2fce424e0df44f48427ba8413a880`.
- Leads: 37 total; Retailer 17; Distributor 20; Retailer Payment 13; Distributor Payment 0.
- Pipeline transition operations: 61; Calls: 2,923; users: 9; tasks: 801.
- Proven Pipeline stage tasks: 62 total / 44 active. Proven registration tasks: 48 total / 36 active. No ambiguous lead-related task rows were observed.
- Database: 28,675,219 bytes. Storage: 7,141,529 bytes / 60 objects.

## Implementation steps

1. Freeze side-effect and authority map from deployed catalog and current source.
2. Add migration 037: Converted enum, owner-only RPC/RLS, global active-user reads, disable task triggers, cancel proven derived tasks, correct exact Retailer Payment targets with system audit.
3. Simplify UI/API/repository stages and bounded reads; preserve Distributor behavior and separate reassignment.
4. Add Resource Budget contract, diagnostics runbook, semantic harness guards, and CI PostgreSQL integration.
5. Run focused, PostgreSQL, browser, full regression, harness, and two adversarial reviews; stop for owner migration.

## Verification

- Focused/full Jest, typecheck, lint, production build, Pipeline browser E2E, disposable PostgreSQL fresh apply/integration, harness, CI, preview, and two adversarial reviews.

## Production safety

- [x] Production mutation explicitly authorized or not applicable: owner-only migrations remain unapplied by Codex.
- [x] Schema/RLS impact explicitly authorized or not applicable: exact SQL will be handed to owner.
- [x] Read-only audit completed where production state matters.
- [x] Secrets and production connections excluded from CI/local tests.

## Rollback

Before owner migration, revert application branch. After migration but before release, leave additive enum/audit changes and disabled triggers in the safer state; do not reverse corrected leads without explicit owner review.

## Decision log

- Split schema authority (037) from Retailer data correction (038) because PostgreSQL enum additions cannot be safely consumed in the same migration transaction.
- Archive proven generated tasks with lifecycle metadata; preserve completed and ambiguous work.

## Progress

- [x] Production/read-only catalog fingerprint and side-effect map.
- [x] Authority/resource implementation and focused tests.
- [ ] Full gates, CI, preview, and owner migration handoff.
