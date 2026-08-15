# Execution Plan: Payment Collection Renewals

## Goal

Expose the existing canonical distributor renewal authority as a first-class, bounded Payment Collection experience for Admin and assigned employees, then release it through the owner-controlled function migration boundary.

## User intent lock

- **USER REQUEST:** Payment Collection needs a visible Renewals option with four urgency cards, bounded server filtering, and manual date editing.
- **EXPECTED USER FLOW:** Payment Collection → Renewals → choose urgency or distributor → set/replace date → save → Payment Collection, Distributor Status, and My Day read the same canonical fact.
- **CANONICAL AUTHORITY:** `public.distributor_accounts.renewal_date`; ownership is `assigned_to`; optimistic concurrency is `version`; mutation is `distributor_status_command_v1(..., 'renew', ...)`; audit is `distributor_status_events`.
- **WHAT MUST NOT CHANGE:** Receivables/payment authority, financial arithmetic, Pipeline, Tasks, Calls, Field Visits, Attendance, Leads, existing My Day semantics, or Distributor operational identity.

## Change classification

- UI: `UI_ONLY`
- Bounded renewal read contract: `API`, `DATABASE`
- Existing renewal command reuse: `AUTHORIZATION`, `CROSS_DOMAIN`
- Release and owner SQL: `DEPLOYMENT`
- Offline contract: unchanged; renewal commands remain online/server-confirmed.

## Current state

Current main and read-only production inspection agree:

- `renewal_date date`, `assigned_to uuid`, and `version bigint` exist on `distributor_accounts`.
- `distributor_status_command_v1` already authenticates active actors, authorizes Admin or exact assignee, locks the row, checks expected version, updates only renewal authority, writes an event and operation receipt, and returns canonical state.
- `distributor_renewals_due_v1` already powers My Day but returns only actionable rows/total; it cannot supply exact four-bucket metrics or arbitrary server-side list filters.
- `distributor_assignee_renewal_idx(assigned_to, renewal_date, distributor_id) where renewal_date is not null` already exists.
- Production currently has zero distributor/renewal rows; production testing must remain read-only.

## Invariants

- One fact, one authority, many readers.
- Past date is valid and projects as overdue; null remains not set outside the renew command.
- Employee scope derives only from canonical assignment; Admin scope derives server-side.
- Exact `expected_version` prevents silent overwrites.
- Renewal mutation writes only distributor account/event/receipt authority.
- Initial screen: one metrics request plus one list request, list page at most 50, no polling, no N+1, no `SELECT *`.
- Empty, unauthorized, unavailable, and server-error states remain distinct.

## Non-goals

- No second renewal field, command, event/history table, reminder row, Task, Pipeline follow-up, or automatic date calculation.
- No Receivables redesign, financial mutation, production fixture, speculative index, or change to the existing My Day reader.

## Affected domains

Distributor Status authority, Payment Collection UI, My Day reader, Engineering OS/harness, and a function-only Supabase migration.

## Implementation steps

1. Add additive service-only renewal metrics/list RPCs; preserve existing My Day RPC and command.
2. Extend the existing renewal API with typed metrics/list modes and bounded validated filters.
3. Build one shared Renewals screen used by Admin and employee routes; add consistent Payment Collection navigation.
4. Reuse `RenewalEditorModal` and improve stale-conflict refresh.
5. Add database role/concurrency/idempotency/write-set/10k tests and UI write-to-read closure coverage.
6. Extend existing OS/harness with intent/classification/authority/resource/route/write-set safeguards.
7. Produce exact pure-SQL owner artifacts and certify them on disposable PostgreSQL 17.6.
8. Run R3 gates, adversarial review, PR/Preview/CI, then stop at owner-only production SQL application if required.

## Verification

- Focused Jest and API runtime tests.
- Disposable PostgreSQL 17.6: fresh 039→040→041→042, RLS, roles, concurrency, idempotency, financial/cross-domain write set, and 10k plans/timings.
- Playwright Admin/employee/other-role/empty/error/card-filter/edit closure.
- Full Jest, typecheck, lint, build, E2E, harness, exact-head CI, and Vercel Preview.
- Read-only production smoke only after owner migration and merged exact-main deployment.

## Production safety

- [x] Production data mutation is not authorized and will not occur.
- [x] Schema change is limited to additive/replaced read functions; no table, column, index, RLS, or data rewrite.
- [x] Read-only production schema and row-count audit completed.
- [x] Tests and CI refuse production fixtures and use disposable PostgreSQL.
- [x] Secrets and production connections are excluded from local/CI tests.

## Rollback

Revert the application PR. If migration 042 was applied, keep the harmless service-only read functions or apply a separately reviewed owner rollback; the existing My Day RPC and renewal command remain untouched.

## Decision log

- No second renewal authority, command, event table, date helper, employee directory, or index is created.
- A function-only migration is necessary because the exact metrics and filtered-list contracts cannot be produced from the existing limited My Day RPC without either inaccurate client aggregation, four database count requests, or an unbounded read.
- The existing composite assignee/renewal index is retained pending 10k `EXPLAIN`; no speculative index is added.

## Progress

- [x] Current-main forensic trace
- [x] Read-only production schema/index/function verification
- [x] Implementation and focused tests
- [x] Local R3 verification and adversarial review
- [ ] PR, Preview, exact-head CI
- [ ] Owner migration and production certification
