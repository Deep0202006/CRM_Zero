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
- `RECEIVABLES_V1_READY` is server-only, defaults false, and fails mutations closed before schema activation.

## AUTHORIZATION

- System Administrator: all bounded reads, create/import, assignment/correction, direct confirmed payment, report verification/rejection, reversal, dispute/resolve, cancellation, export.
- Assigned active employee: own bounded reads/history and Contacted, No Response, Promise to Pay, Payment Reported commands.
- Other employees: no read or mutation. Admin read capability does not make Admin the assigned operational actor.
- Browser roles, user IDs, and assignment claims are never authority. Browser clients have no financial INSERT/UPDATE/DELETE grants.

## FOLLOW-UP AND ALERTS

`bill_due_date` and `next_follow_up_date` are distinct. Current alert is deterministically derived in IST; no reminder rows or cron synchronization exist. Pending verification suppresses employee chase alerts. Paid/cancelled produce none; disputed pauses ordinary reminders. A new follow-up supersedes stale promise state.

## IMPORT

Manual entry and spreadsheet import share canonical validation. Preview performs no write. XLSX/XLS/CSV are limited to 10 MB and 5,000 rows. Money and controlled Indian/ISO dates are parsed without binary-float financial authority. Assignment uses exact active-user email or an exact unique name fallback. Server revalidates canonical payload, employees, duplicates and conflicts, then creates accepted rows in one transaction. Business identity is distributor code (when present) or conservative normalized name plus normalized bill reference.

## DOMAIN ISOLATION

Receivables never writes Tasks, Call Logs, Field Visits, `lead_payment_details`, Pipeline stages, generic Follow-ups, or Team Chat/push tables. Field Visit `payment_follow_up` and Pipeline Payment remain non-authoritative legacy mechanisms. My Day uses `/api/my-day/receivables` and a dedicated priority panel before ordinary queues.

## RELEASE

Migration `033_receivables_v1.sql` is additive and review-only until owner approval. Application deployment remains inert while readiness is false. Production verification is read-only; no dummy financial records may be created and deleted.

## KNOWN LIMITATIONS

V1 has internal CRM alerts only, online-only commands, no customer messaging, no legacy migration, and no employee export. Local migration execution is evidence only and never proves production state.

