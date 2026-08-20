# Receivables Contract

## CURRENT

Receivables is the financial-critical authority for Payment Collections. PostgreSQL-confirmed rows and service-only transactional functions own bills, payment verification, balances, versions, audit history, import batches, and operation receipts. Employee-facing Payment Follow-ups, Admin Payment Collections, and the My Day priority panel consume bounded server read models.

## AUTHORITY AND MONEY

- `receivables` is money owed; `receivable_payments` is immutable payment identity; activity and operation receipts are append-only evidence.
- PostgreSQL `numeric(14,2)` is authoritative. Only `confirmed` payments reduce outstanding; `reported`, `rejected`, and `reversed` payments do not.
- Payment state is derived: Cancelled/Disputed override Unpaid/Partially Paid/Paid. Paid means outstanding is exactly zero; outstanding cannot be negative.
- Confirmed payment correction is Admin-only reversal with a reason. No financial row is deleted.
- Bill/distributor identity is immutable in V1. Bill amount cannot be reduced below confirmed payments.

## COMMANDS AND RECOVERY

- Every mutation uses an authenticated server API and service-only database function with a stable `operation_id`, canonical request hash, actor identity, and (for an existing receivable) `expected_version`.
- Same operation, actor, and payload returns the stored logical result. Reuse with a different payload or actor fails. Row locks prevent double confirmation, overpayment, and last-writer-wins updates.
- The server derives actor identity and checks active account/capability. Database functions independently enforce Admin/assignment rules despite service-role execution.
- V1 commands require online server confirmation. A lost response is retried with the same semantic command; UI never calls uncertain or reported money confirmed.
- Only network/unreadable-response/5xx outcomes remain in the owner-scoped recovery outbox. Authoritative 4xx validation, authorization, conflict, mismatch, and ineligible results are retained as terminal evidence but never automatically retried.
- Deterministic unique-identity failures are typed terminal results (`RECEIVABLE_DUPLICATE` or `PAYMENT_DUPLICATE`). Only the failing insert subtransaction is caught and rolled back; unexpected database failures still propagate as retryable infrastructure uncertainty.
- `RECEIVABLES_V1_READY` is server-only, defaults false, and fails mutations closed before schema activation. Authenticated `/api/receivables/health` exposes only typed readiness/compatibility status; Admin UI disables intake with an explicit activation message instead of presenting dead controls.

## AUTHORIZATION

- System Administrator: all bounded reads, create/import, assignment/correction, direct confirmed payment, report verification/rejection, reversal, dispute/resolve, cancellation, export.
- Assigned active operational employee: own bounded reads/history and Contacted, No Response, Promise to Pay, Payment Reported commands. Admin accounts are excluded through the same canonical employee-directory authority reused by Distributor Status and import, and are rejected by the database assignment trigger.
- Other employees: no read or mutation. Admin read capability does not make Admin the assigned operational actor.
- Browser roles, user IDs, and assignment claims are never authority. Browser clients have no financial INSERT/UPDATE/DELETE grants.

## FOLLOW-UP AND ALERTS

`bill_due_date` and `next_follow_up_date` are distinct. An initial active receivable requires a non-null follow-up date of today or later. Payment dates may be historical but never future-dated in IST. Current alert is deterministically derived in IST; no reminder rows or cron synchronization exist. Pending verification suppresses employee chase alerts. Paid/cancelled produce none; disputed pauses ordinary reminders. A new follow-up supersedes stale promise state.

Zero confirmed outstanding is terminal for employee Contacted, No Response, Promise, and Payment Report commands. A pending reported payment also pauses all four commands at database authority; V1 permits only one pending report per receivable. Employee reports must be positive and no greater than current confirmed outstanding. Lifecycle transitions are explicit: active→disputed, disputed→active, and active/disputed→cancelled under cancellation rules; every other transition is rejected.

## IMPORT

Manual entry and spreadsheet import share canonical money validation. Admin intake uses focused accessible modals; import supports drag/drop, same-file reselection, an XLSX template/instructions sheet, and the first meaningful worksheet. Preview performs no write and authoritatively classifies each row. Its hash binds the complete canonical classification and resolved persisted plan, including identity, visible/contact fields, money, dates, assignee, notes, row number, and generated receivable ID. XLSX/XLS/CSV are limited to 10 MB and 5,000 rows. UTF-8 BOM/Unicode, controlled Indian/ISO dates, and safe Excel values are accepted without binary-float financial authority. Assignment uses exact active operational-employee email. Server revalidates canonical payload, employees, duplicates and conflicts. The database validates every row into indexed transaction-local staging before creating the batch, accepted rows, creation events, and receipt; it never repeatedly concatenates a growing JSON document. An unexpected mutation-phase failure raises and rolls back the transaction. Business identity is distributor code (when present) or conservative normalized name plus normalized bill reference.

The unified distributor master workbook is the exact `ZeroData_Distributor_Master_Import.xlsx` / `CRM_DISTRIBUTOR_MASTER_V1` contract documented in Distributor Status. Its `Receivables` sheet has exactly eight columns: `Distributor Reference`, `Bill Reference`, `Contact Person`, `Contact Phone`, `Bill Amount`, `Bill Due Date`, `Payment Follow-up Date`, and `Notes`; assignment is not duplicated in this sheet. Its Payments rows use the same exact bill target plus a required `Payment Import Key`. The key represents one source-ledger payment identity and must remain stable on retry. Parsing canonicalizes exact money to two-decimal text and dates to `YYYY-MM-DD`, rejects unknown or duplicate headers and all formula cells, and enforces the shared 10 MB / 5,000-total-row bound before any authoritative preview. The Instructions example `ZD-MUM-001 | INV-2026-001 | Priya Shah | +91 98765 43210 | 84500.00 | 2026-09-01 | 2026-08-25 | Annual platform fee` consists only of literal values. These format rules do not allocate payment to a distributor aggregate and do not change the Receivables/payment authorities.

Master Receivables resolve Distributor Reference to the canonical UUID, including a stable UUID for a Distributor created earlier in the same atomic plan. A Distributor must be `billed` in its post-import Distributor plan, so billed onboarding and its first obligation may coexist in one workbook; billing status alone never creates an obligation. Assignment is derived from that same post-import Distributor's exact active non-Admin `assigned_to` authority and is not independently editable on the eight-column Receivables sheet. Bill identity is exact `distributor_id + normalized Bill Reference`. A set-based, service-only Migration 046 resolver returns matching canonical bills and their exact confirmed totals for at most 5,000 supplied identities and performs no write. Exact duplicates compare canonical UUID, exact decimal amount, due/follow-up dates, derived assignee, contact person, and contact phone and produce no Receivable mutation. Any differing critical field is a blocking conflict; no overwrite or second bill is attempted. A current or future IST follow-up is required only when the complete valid planned payment set leaves a positive outstanding balance; a fully paid final plan may leave it blank and the canonical payment authority clears it.

Master Payments target only the exact canonical `receivable_id` resolved from Distributor Reference plus Bill Reference; there is no distributor-aggregate allocation. Nullable `receivable_payments.import_key` is immutable source-ledger identity scoped to that Receivable and protected by a unique normalized per-Receivable partial index, leaving legacy/manual events without an import key compatible. Its stable payment UUID is derived from the exact Receivable UUID plus normalized import key, independent of workbook row or retry operation. An existing confirmed event with the same key and identical amount, date, mode, reference, and note is skipped; changed details or a reported, rejected, or reversed event with that key are blocking conflicts. Concurrent attempts are serialized by Receivable locks and the database uniqueness invariant; a uniqueness race fails the complete atomic import instead of duplicating money.

The service-only payment helper locks exact Receivables in UUID order, validates and stages the complete payment set before persistent mutation, and rejects cancelled targets, future IST dates, unsafe partial follow-up, and cumulative overpayment. Accepted rows are inserted directly as immutable `confirmed` payment events with matching `payment_confirmed` activity; they are never inserted as reported and silently promoted. Only effective confirmed, non-reversed rows contribute to the staged balance. Receivable version/timestamp and terminal follow-up are updated, while Unpaid, Partially Paid, Paid, Disputed, outstanding, and collected totals remain derived exclusively by the existing financial read authority.

Master preview resolves the complete Distributor → Receivable → Payment dependency graph without writing. Set resolvers read only exact supplied identities; same-workbook stable UUIDs are overlaid before the next sheet is classified. Every financial row exposes its closed classification, explicit action, authoritative Before, and proposed After values, including cumulative After balances for every planned Payment. Any upstream conflict makes dependent rows blocking rather than redirecting them. The canonical plan hash includes classifications, actions, exact UUIDs, financial strings, balances, and mutation payloads. Confirmation reparses the uploaded workbook and performs the same current-authority resolution again; any changed resolved plan returns HTTP 409 `IMPORT_REFRESH_REQUIRED` before mutation is eligible to begin.

After identical-hash revalidation, the API sends the complete execution payload through exactly one service-only master RPC. Its outer PostgreSQL subtransaction contains canonical Distributor/Renewal writes, Receivable writes, and confirmed Payment writes plus their events and receipts. A deterministic validation, version, uniqueness, bill-conflict, payment-key, or overpayment rejection raises before the outer block returns, undoing all prior domain writes. Infrastructure errors are not converted to success or safe retry evidence; they remain uncertain while PostgreSQL rolls back the failed statement.

## REPORTING SEMANTICS

Cancelled balances are excluded from collectible outstanding, overdue, and aging. Disputed balances remain included and are exposed separately. Collected This Month uses confirmed payments whose `payment_date` falls in the IST month, independent of verification timestamp. My Day totals aggregate the complete urgent set while display rows are limited to five. Admin export is capped at 10,000 rows, uses the same server filters as the table, uses an IST filename date, and neutralizes formula-capable user text before workbook generation.

## DOMAIN ISOLATION

Receivables never writes Tasks, Call Logs, Field Visits, `lead_payment_details`, Pipeline stages, generic Follow-ups, or Team Chat/push tables. Field Visit `payment_follow_up` and Pipeline Payment remain non-authoritative legacy mechanisms. My Day uses `/api/my-day/receivables` and a dedicated priority panel before ordinary queues.

Distributor Status is an adjacent operational authority. A resolved Receivable may display its canonical distributor renewal date/state, but Receivables does not own or duplicate that date. An unavailable optional Distributor projection is reported separately and cannot suppress authoritative financial detail or My Day collections. Distributor `billing_status=billed` never creates or confirms a Receivable or Payment.

## RELEASE

Migrations `033_receivables_v1.sql`, `034_receivables_production_completion.sql`, and `035_receivables_import_linearization.sql` are additive and review-only until owner approval. Apply them once, in order, through the Supabase migration mechanism; they are not advertised as rerunnable. Migration 034 adds the active non-Admin operational-assignee guard; migration 035 replaces only the import function with indexed transaction-local staging. Neither rewrites business rows. A disposable PostgreSQL 17.6 CI job matching the production major applies all migrations and executes money, idempotency, concurrency, state-machine, 5,000-row import success/rollback, assignment, metrics, pagination, and RLS tests. The fixture runner refuses the production project/host. Application deployment remains inert while required schema is not deployed. Production verification is read-only; no dummy financial records may be created and deleted.

## KNOWN LIMITATIONS

V1 has internal CRM alerts only, online-only commands, no customer messaging, no legacy migration, and no employee export. Local migration execution is evidence only and never proves production state.
