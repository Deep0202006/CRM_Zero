# Execution Plan: CRM-P1-047 ERP distributor and partner visibility

## Goal

Add one canonical ERP dimension owned by Distributor Status, project it to internal readers, and provide a strictly scoped read-only external ERP Partner Viewer.

## Non-goals

- No ERP backfill or production mutation by Codex.
- No new renewal, receivable, payment, or collection-state authority.
- No changes to migrations 001–046.
- No fuzzy ERP or Distributor identity matching.

## Current state

Migration 046 is production-certified. Distributor facts and renewal date are owned by `distributor_accounts`; financial state remains derived from `receivables` and effective `receivable_payments`.

## Invariants

- One ERP registry and one nullable Distributor ERP foreign key feed every reader.
- External scope is enforced by server/database authority, never UI filtering.
- ERP Partner Viewer is exclusive and cannot participate in employee assignment, attendance, queues, sync, or financial/internal APIs.
- Import omission preserves ERP; only explicit `[CLEAR]` removes it from existing Distributors.
- Product code is not merged before Owner certifies Migration 047.

## Affected domains

Distributor Status, Renewal, Payment Collections, Receivables read projections, imports, auth, and ERP partner access.

## Implementation steps

1. Add Migration 047 ERP/access authorities and invariants.
2. Add ERP to manual and both workbook paths.
3. Add bounded ERP reads/filters to three internal surfaces.
4. Add the scoped external portal, account management, API security, and runtime isolation.
5. Update contracts and Graph learning, then verify focused risks.

## Verification

Focused unit/API/E2E tests locally; GitHub Actions PostgreSQL for Migration 047; exact-head CI, build, and Vercel Preview before Owner handoff.

## Production safety

- [x] Production mutation is not authorized for Codex.
- [x] Schema/RLS impact is explicitly authorized through Migration 047 and Owner gate.
- [ ] Read-only production precheck completed before handoff.
- [x] Secrets and production connections are excluded from CI/local tests.

## Rollback

Product remains unmerged until schema certification. Any post-application correction is forward-only Migration 048; never edit or rerun 047 blindly.

## Decision log

- GitHub Actions PostgreSQL is authoritative disposable database proof; no local database tooling will be downloaded.
- Master Workbook V2 reuses Migration 046 orchestration and Distributor authority payload.

## Progress

- Worktree created from Graph v1.2 main `84b944e97efcf01404fe65e2e0e09dbfd23913ea`.
