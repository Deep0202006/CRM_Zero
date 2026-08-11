# Execution Plan: Receivables V1

## Goal

Deliver financial-critical Payment Collections with authoritative server balances, durable idempotent commands, strict assignment/admin authorization, safe import, dedicated employee/Admin surfaces, and an isolated My Day projection.

## Non-goals

- No customer-facing messaging or payment links.
- No migration, rewrite, or authority derived from Field Visits, Pipeline, Calls, generic Tasks, generic Follow-ups, or Team Chat.
- No offline Admin financial confirmation and no general-purpose financial sync engine.
- No production migration execution, production test records, merge, or automatic activation.

## Current state

- Branch `feat/receivables-v1` starts from fetched `origin/main` at `fbbdce0f328fbe9ba49c10c8a9a7f8e8e8450cbd` (2026-08-10).
- Pre-existing untracked `.codex-artifacts/` and `docs/data-platform-repair/` are outside task scope and preserved.
- Forensic analysis is in progress; migration numbering currently ends at 032, so 033 is available.
- Generic My Day follow-ups are Task/Call-derived; Field Visit `payment_follow_up` projects Distributor visits; Pipeline Payment is a lead stage; Team Chat push uses conversation subscriptions. All remain separate and non-authoritative for money.
- Existing server routes derive bearer identity and use server-only service clients. Receivables follows that boundary but confines all writes to dedicated transactional RPCs.

## Invariants

- PostgreSQL `numeric(14,2)` and server/database functions own financial arithmetic and state.
- Only confirmed, non-reversed payments reduce outstanding; reports never imply Paid.
- Every mutation is atomic, actor-authorized, version checked, operation-id idempotent, audited, and returns canonical state.
- No financial record DELETE path and no cascade deletion.
- Browser code cannot mutate financial tables directly or receive service-role credentials.
- One deterministic IST alert projection per receivable; no cron reminder rows.
- Deployment before schema activation fails closed through server-only `RECEIVABLES_V1_READY`.

## Affected domains

Primary: receivables. Protected boundaries: auth, My Day/shared UI, Supabase, Field Visits, Follow-ups, Pipeline, Calls, Team Chat, and Team KPI.

## Failure and threat model

- Retry/double-click/lost response/two devices: stable operation receipt plus canonical request hash inside the same transaction.
- Concurrent Admin or stale employee: row lock, expected version, current actor/assignment validation, typed conflict with canonical row.
- Confirmation/reversal races and overpayment: locked receivable/payment, eligibility checks, exact numeric aggregate, single transition.
- Assignment changes mid-page/session expiry/forged identity: server derives authenticated actor; database function independently receives verified actor and checks active role/assignment.
- Partial/full/rejected/reversed payments: state is derived from immutable payment history; alert projection follows current authoritative state.
- Stale promises/follow-ups: latest semantic command sets/supersedes operational next action atomically and appends history.
- Imports: bounded parse, strict headers/money/date/employee resolution, O(n) duplicate analysis, server canonical hash/revalidation, transactional batch.
- Deployment-before-schema and service-role exposure: readiness defaults false, server-only client, typed unavailable response, client-source invariant guard.
- Offline/uncertain request: V1 financial and operational commands require online server confirmation; UI keeps the stable operation id for exact retry and never labels uncertainty confirmed.

## Implementation steps

1. Complete forensic analysis and record existing authority/boundaries.
2. Add contract, compact skill, harness domain, and intentionally failing invariant/domain tests.
3. Add unapplied additive migration and migration contract tests.
4. Implement server domain primitives, readiness/auth, reads, idempotent/versioned commands, RLS/function boundaries.
5. Implement shared manual/import validation, preview, atomic confirmation, fixtures and scale tests.
6. Implement paginated Admin workspace/detail/verification/reversal/export.
7. Implement assigned-employee workspace and semantic follow-up/payment-report actions.
8. Add the dedicated top-of-My-Day priority panel and isolation regression tests.
9. Harden races/recovery, run two-pass adversarial review, fix P0/P1.
10. Run R3 gates, update durable OS knowledge, create intentional commits, and prepare/open a draft PR if authenticated tooling permits.

## Verification

- Harness preflight/related/scope/guard/docs/verify/full as prescribed.
- Focused Receivables money, follow-up, security, concurrency, import, UI, migration, and isolation suites.
- Protected Field Visit, Follow-up, Calls, Pipeline, Team KPI, auth and Team Chat suites.
- Full Jest, TypeScript, lint, production build, and diff review.
- Local Supabase/Postgres migration integration only if existing tooling is available; otherwise record the evidence gap.
- GitHub CI and Vercel preview evidence only through the draft-PR workflow; no production writes.

Latest local evidence (2026-08-11): `npm run harness:verify` passed R3 scope, invariant guard, related tests, full Jest (49 suites / 332 tests), TypeScript, lint with 35 non-blocking repository warnings, and production build. Focused Receivables suites: 5 suites / 29 tests. Migration runtime integration was unavailable because Supabase CLI, Docker, and `psql` are not installed.

## Production safety

- [x] Production mutation is not authorized; all development verification is local/mock/read-only.
- [x] Schema/RLS design is authorized as source code only; migration execution is not authorized.
- [ ] Read-only schema/name collision audit completed where credentials/tooling permit.
- [x] Secrets and production connections are excluded from CI/local tests.

## Rollback

Keep `RECEIVABLES_V1_READY=false` (or unset) to disable all mutation surfaces. Application rollback is deployment rollback. Migration is additive and retained for audit; do not drop financial history as an application rollback. Any database rollback requires owner-reviewed preservation/export strategy.

## Decision log

- 2026-08-11: R3 per owner and OS; migration 033 source only.
- 2026-08-11: Fail closed online-only V1 commands chosen over a new offline financial outbox; stable operation IDs cover uncertain HTTP outcomes.
- 2026-08-11: Existing untracked work explicitly excluded and preserved.
- 2026-08-11: Adversarial data/security pass found stale-promise projection, missing active-assignee/date enforcement, and unstable import retry row IDs; fixed with latest-action projection, database checks, and operation-derived row UUIDs.
- 2026-08-11: Product/failure pass found uncertain commands needed durable exact replay; added a narrowly user-keyed Receivables outbox. Generic sync remains uninvolved.
- 2026-08-11: Supabase CLI, Docker, and local `psql` are unavailable; SQL has static contract coverage but no local PostgreSQL runtime proof.

## Progress

- [x] Latest main fetched and feature branch created.
- [x] R3 manifest and active plan created.
- [x] Forensic analysis and local name/schema audit; production catalog access was unavailable and no customer data was read.
- [x] Contract/tests/migration source.
- [x] Server foundation and initial application surfaces.
- [x] Two conceptual adversarial passes completed; P0 retry/date/stale-promise findings fixed.
- [x] Admin authoritative metrics, aging, and payment verification queue added.
- [ ] Complete Admin detail UI, direct-payment/reversal/reassignment/correction/dispute/cancel controls, export, and full filter set (backend commands/detail read exist except export).
- [ ] Complete pre-confirmation exact/conflicting duplicate classification and richer employee/import forms.
- [ ] Expand UI/import/concurrency database integration coverage to the owner-specified full matrix.
- [x] R3 local harness verification passed; GitHub CI/Vercel remain pending draft PR.

## Adversarial review

Data/security pass: P0 stale promise projection, unstable import retry IDs, missing active-assignee/date checks, partial-payment stale follow-up acceptance, and uncertain command durability were fixed. No remaining known financial-correctness P0 in reviewed source. Product/failure pass: P1 Admin action/detail breadth, export, import preview duplicate classification, and complete UI/test matrix remain open; these block COMPLETE status but fail closed rather than risking money.
- [ ] Draft PR preparation.
