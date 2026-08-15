# Distributor Status Contract

## CURRENT

Distributor Status is the operational lifecycle and renewal sub-domain beneath Payment Collections. `distributor_accounts.distributor_id` is the single account identity. Optional Lead linkage and exact Receivables identity references never transfer mutation authority.

## AUTHORITY

- Distributor Status owns installation, training, mapping, activity, operational billing indication, assigned employee, renewal date, version, and immutable operational events.
- Receivables exclusively owns invoice amounts, balances, reported/confirmed payments, reversals, and financial events. `billing_status=billed` creates no financial row.
- Facts are orthogonal. Mapping is `pending`/`done` for current records and nullable only for historical rows where it was never captured. No historical mapping state or date is fabricated.
- Mapped means installation, training, and mapping are done. Active/Inactive and Billed remain overlapping projections and do not imply Mapped.
- Renewal reminders derive from the one PostgreSQL `renewal_date`: T-2, T-1, today, and overdue. No Task, reminder row, Pipeline follow-up, Call, or polling is created.

## IDENTITY AND IMPORT

Mutable names are not primary identity. A unique distributor reference is preferred; name-only preview is conservative and becomes ambiguous when multiple matches exist. Preview writes nothing. Commit reconstructs authority server-side, revalidates mapping and all other facts, uses a stable operation/hash, and commits atomically. XLSX/XLS/CSV are bounded to 10 MB and 5,000 rows; spreadsheet bytes are never stored.

## AUTHORIZATION AND CONCURRENCY

Admin may read all and perform manual, import, reassignment, mapping, lifecycle, billing, and renewal mutations. An assigned active employee may read its own rows and manually set that row's canonical renewal date, but cannot change any other operational fact. The server derives actor/Admin authority and database functions enforce it again. Every mutable command carries `expected_version`; stale writers receive a conflict with canonical current state. Lost-response retry reuses the stable operation ID.

## READ, WRITE, AND FAILURE BUDGET

Initial Admin load is one aggregate request for all eight cards and one explicit-column list request of at most 50 rows. One bounded canonical employee-directory read is shared with Payment Collection. There is no polling, full-table hydration, N+1 owner lookup, Realtime subscription, binary evidence, or hot `select('*')`.

Mutations may write only `distributor_accounts`, `distributor_status_events`, `distributor_operation_receipts`, and `distributor_import_batches`. They never write Leads, Pipeline, Tasks, Calls, Attendance, Field Visits, Receivables, Payments, or Chat. A zero-row result is an active empty feature. Unauthorized, capability-missing, and server-error outcomes remain typed and are never converted to an empty array.

## RELEASE

Migration `041_distributor_mapped_status.sql` is the next additive owner-reviewed change. It preserves historical rows with nullable mapping truth, sets the default only for future rows, replaces bounded command/import/metrics functions, and performs no backfill or cross-domain write. It must be fresh-applied after 039/040 and tested on disposable PostgreSQL 17.6. Codex never applies it to production; production verification is read-only and uses no synthetic records.
