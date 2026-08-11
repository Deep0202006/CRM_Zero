# Execution Plan: Receivables V1

## Goal

Deliver financial-critical Payment Collections with authoritative server balances, durable idempotent commands, strict assignment/admin authorization, safe import, dedicated employee/Admin surfaces, and an isolated My Day projection.

Final certification round: independently attack the merged production-completion implementation from `origin/main` at `3f0354f6b2d4cd3c9d570c57db867bb480d7e323` on `fix/receivables-final-certification`. This round is test/break/fix/retest only, uses disposable deterministic fixtures, and permits no production business-data mutation.

Certification found two release defects: export cells were not protected from spreadsheet formulas and exact-10,000-row exports were rejected; the 5,000-row import function also accumulated growing JSONB state with O(nÂ²)-style copying. Export is corrected in application code. Migration 035 replaces only the import function with indexed transaction-local staging and remains unapplied pending owner review.

Production-completion round: make the merged feature operationally usable end to end, especially Admin manual/file intake, readiness diagnosis, template/download, browser-level workflows, and active OS regression gates. Work is on `fix/receivables-production-completion` from fetched `origin/main` at `12a1fe1fe4952893a97ae95724b9009af203e5fc`.

## Non-goals

- No customer-facing messaging or payment links.
- No migration, rewrite, or authority derived from Field Visits, Pipeline, Calls, generic Tasks, generic Follow-ups, or Team Chat.
- No offline Admin financial confirmation and no general-purpose financial sync engine.
- No production migration execution, production test records, merge, or automatic activation.

## Current state

- Read-only production diagnosis on 2026-08-11 found Vercel Production deployed from `12a1fe1`, but `RECEIVABLES_V1_READY` is absent. Zero-row service-role probes returned 404 for `receivables`, `receivables_read_v1`, `receivable_payments`, and `receivable_import_batches`, proving migration 033 is not present without reading customer content. Production writes were not attempted.
- The merged Admin page uses a bare file input, reads only the first worksheet, has no health/readiness surface, template, drag/drop/change/remove lifecycle, same-file reset, or browser-level intake coverage. These are product defects independent of the deliberately closed deployment.
- Existing money, authority, idempotency, state-machine, atomic-import, RLS, PostgreSQL 17.6, and pagination foundations are retained unless a focused test proves a defect.

- Branch `feat/receivables-v1` starts from fetched `origin/main` at `fbbdce0f328fbe9ba49c10c8a9a7f8e8e8450cbd` (2026-08-10).
- Pre-existing untracked `.codex-artifacts/` and `docs/data-platform-repair/` are outside task scope and preserved.
- Forensic analysis is in progress; migration numbering currently ends at 032, so 033 is available.
- Generic My Day follow-ups are Task/Call-derived; Field Visit `payment_follow_up` projects Distributor visits; Pipeline Payment is a lead stage; Team Chat push uses conversation subscriptions. All remain separate and non-authoritative for money.
- Existing server routes derive bearer identity and use server-only service clients. Receivables follows that boundary but confines all writes to dedicated transactional RPCs.
- CTO hardening review on 2026-08-11 rejected the foundation for merge: import validation returned after earlier inserts, runtime PostgreSQL evidence was absent, and owner-required P1 application surfaces remained incomplete. PR #23 remains draft; this plan is the single active record for the remediation.
- Final release-candidate review accepted the architecture but identified bounded authority gaps: paid/pending employee commands, lifecycle transitions, cancellation with a report, typed duplicate constraints, complete import-plan hashing, employee pagination/order, and production-major CI parity. Work remains confined to those findings.

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
- Batch validation is a read-only phase. Persistent batch/receivable/event/receipt writes begin only after every row is classified; unexpected mutation-phase errors propagate and roll back the transaction.
- Static SQL checks are supplementary only. Migration execution, financial commands, RLS, concurrency, and late-row import rollback run against disposable PostgreSQL 16 in CI without production credentials.

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
11. Add authenticated readiness health and clear unavailable UI, then complete Admin modal-based manual/import intake with template, meaningful-sheet parsing, same-file recovery, and authoritative preview.
12. Add browser-level Admin/employee critical-flow coverage and generic financial-domain harness enforcement; rerun PostgreSQL 17.6 and two-pass adversarial review.
13. Push the new completion branch and open a new draft PR. Stop before production activation because owner application of migration 033 is required.

## Verification

- Harness preflight/related/scope/guard/docs/verify/full as prescribed.
- Focused Receivables money, follow-up, security, concurrency, import, UI, migration, and isolation suites.
- Protected Field Visit, Follow-up, Calls, Pipeline, Team KPI, auth and Team Chat suites.
- Full Jest, TypeScript, lint, production build, and diff review.
- Local Supabase/Postgres migration integration only if existing tooling is available; otherwise record the evidence gap.
- GitHub CI and Vercel preview evidence only through the draft-PR workflow; no production writes.

Latest hardening evidence (2026-08-11): focused Receivables suites pass (6 suites / 41 tests after hardening additions), full Jest passes (50 suites / 345 tests), TypeScript passes, and the Next.js 16 production build passes. Local PostgreSQL remains unavailable; the pinned PostgreSQL 16.4 disposable CI job is implemented and must pass before release recommendation. Full harness/lint/adversarial/remote gates are pending the final diff.

Production-completion local evidence (2026-08-11): R3 harness passes; related selection is 14 suites / 85 tests; full Jest is 52 suites / 361 tests; TypeScript, build, scope (166 paths), invariant guard (30 executable files), docs, diff check, and harness self-tests pass. Chromium runs three real-route flows covering Admin manual submit, template/corrupt-file recovery, same-file reselection, authoritative preview/confirm/refresh, detail/direct payment/filter, readiness-disabled intake, and employee action/pagination isolation. Lint has 0 errors and 34 pre-existing warnings. PostgreSQL 17.6 CI for migrations 033+034 remains the remote release gate.

## Production safety

- [x] Production mutation is not authorized; all development verification is local/mock/read-only.
- [x] Schema/RLS design is authorized as source code only; migration execution is not authorized.
- [x] Read-only production schema/readiness audit completed: readiness name absent and migration-033 relations unavailable; zero rows requested and no business content read.
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
- 2026-08-11: CTO hardening round requires PostgreSQL 16 CI service, validation-before-mutation import architecture, strict per-command server schemas, real forms, complete Admin controls/filter/export, and terminal/retryable outbox classification before release recommendation.
- 2026-08-11: Disputed balances remain included in Total Outstanding and aging because the debt still exists, but ordinary reminder/due metrics exclude disputed. Cancelled balances are excluded from every collectible metric.
- 2026-08-11: Collected This Month is based on `payment_date` in the IST calendar month, not verification timestamp.
- 2026-08-11: Production completion starts from merged main on a new branch. Live diagnosis is read-only; migration 033 and readiness activation remain owner-gated.
- 2026-08-11: No migration 034 will be invented for UI/observability work. Add one only if a proven database invariant cannot be implemented against migration 033.

## Progress

- [x] Final clean-room certification: authorization attacks, money/state torture, real parallel concurrency, import destruction/rollback/tampering, browser Admin/employee workflows, export formula defense, IST boundaries, performance/security review, and full R3 gates.

- [x] Latest main fetched and feature branch created.
- [x] R3 manifest and active plan created.
- [x] Forensic analysis and local name/schema audit; production catalog access was unavailable and no customer data was read.
- [x] Contract/tests/migration source.
- [x] Server foundation and initial application surfaces.
- [x] Repeated two conceptual adversarial passes against the complete hardening diff.
- [x] Admin authoritative metrics, aging, and payment verification queue added.
- [x] Complete Admin detail UI, direct-payment/verification/reversal/reassignment/correction/dispute/cancel controls, filtered export, and server filter set.
- [x] Complete authoritative pre-confirmation duplicate/conflict/employee classification and accessible employee action forms.
- [x] Add disposable PostgreSQL migration, money, idempotency, concurrency, import rollback, My Day totals, metrics, reason-constraint, and RLS integration coverage.
- [x] R3 harness passed locally; final GitHub verify, PostgreSQL 16.4 integration, and Vercel preview passed at `db8ae55`.
- [x] Prove paid and pending-verification terminal behavior in PostgreSQL.
- [x] Complete lifecycle/cancellation state-machine integration coverage.
- [x] Map deterministic duplicate identities to typed terminal results.
- [x] Bind import preview to every persisted field.
- [x] Add server urgency ordering and employee pagination beyond 50 rows.
- [x] Complete database suite passed on pinned PostgreSQL 17.6; final local R3 harness, two-pass adversarial review, GitHub verify, and Vercel passed at `f8e1fda`.
- [x] Diagnose Production read-only: deployment is current, but readiness is absent and migration-033 relations return zero-row 404.
- [x] Add observable authenticated health plus explicit fail-closed Admin UI.
- [x] Replace permanent Admin intake panels with accessible creation/import workflows, template, meaningful-sheet parsing, file recovery, and resolved preview identity.
- [x] Add browser coverage and generic OS financial guards/CI browser gate.
- [x] Add unapplied migration 034 to reject Admin/inactive operational assignees at database authority, with typed terminal API mapping and rollback tests.
- [x] Production-completion data/security and product/failure adversarial passes; P0/P1=0 locally.
- [ ] GitHub PostgreSQL 17.6/verify jobs and Vercel Preview on the completion PR.

## Adversarial review

Data/security pass: no P0/P1 remained after real PostgreSQL proved migration apply, RLS denial, service-only RPC grants, actor/assignment/version checks, idempotency, overpayment prevention, and concurrent direct-payment locking. Source isolation scans and guards found no browser financial mutation, DELETE, service-key client exposure, or legacy/generic-domain writes.

Product/failure pass: found two P1s and fixed both: increasing a fully paid bill could reopen an active balance without a follow-up, and locally malformed import rows were hidden instead of appearing in preview counts. The DB update command now requires a current follow-up whenever a correction reopens money; Admin preview now combines local invalid rows with authoritative server duplicate/conflict/employee classifications and disables confirmation. No P0/P1 remains known; final gates must rerun after these fixes.

Final release-candidate data/security pass: verified paid and pending employee commands return before version/event/payment mutation; lifecycle and cancellation transitions are typed; unique failures are caught only inside rollback-safe insert subtransactions; 4xx terminal mapping prevents automatic retries; unexpected RPC errors remain 503; RLS/service-role/isolation boundaries are unchanged. P0/P1: none.

Final release-candidate product/failure pass: verified complete preview-plan binding, 75-row global urgency ordering with stable pagination, Load More/count UX, terminal-state employee labels/control hiding, and lifecycle-aware Admin actions. The review found no additional P0/P1 after PostgreSQL 17.6 and local R3 harness evidence.
- Production-completion data/security pass: challenged health information disclosure, stale/local assignee authority, Admin assignment, direct financial browser writes, typed SQLSTATE mapping, import rollback, and service-role isolation. Added server-listed assignees plus migration 034 trigger; rejected assignment leaves no row/event/receipt/version mutation. No local P0/P1 remains.
- Production-completion product/failure pass: challenged readiness false/schema absent, manual confirmation response, template/corrupt/empty/cover-sheet files, same-file retry, Unicode/BOM/calendar dates, import preview identity, disputed metrics, mobile containment, and employee pagination. Browser testing found and fixed a post-confirmation React form-reference bug that could leave successful creation looking failed. No local P0/P1 remains.
- Final-certification data/money/security pass: runtime authorization attacks rejected employee Admin operations and Admin employee impersonation; PostgreSQL 17.6 proved exact numeric state, RLS/service-only grants, paid/pending/lifecycle terminals, idempotency, and parallel direct-payment/confirmation/reassignment/cancellation/correction/reversal/employee-device races. The pass found quadratic import staging and replaced it through unapplied migration 035. Production was count-fingerprinted read-only before/after with no change.
- Final-certification product/failure pass: browser-tested XLSX/XLS/BOM CSV, empty-first-sheet recovery, same-file/replacement flows, operational forms, terminal controls, and mobile/tablet detail. It found formula-capable export cells, an exact-10,000 export off-by-one, unsafe search grammar handling, invalid calendar acceptance, and empty import requests; all gained behavioral regressions. Clean CI: 55 Jest suites / 396 tests, 6 Chromium flows, PostgreSQL 17.6, typecheck, lint (0 errors), build, scope/guard/docs, and Vercel Preview. P0/P1=0; migration 035 owner approval remains the release gate.
- [ ] Draft PR preparation.
