# Distributor Status Contract

## CURRENT

Distributor Status is the operational lifecycle and renewal sub-domain beneath Payment Collections. `distributor_accounts.distributor_id` is the single internal account identity. Optional Lead linkage and conservative Receivables identity matching are references only; neither domain is mutated by Distributor Status.

## AUTHORITY

- Distributor Status owns installation, training, activity, operational billing indication, assigned responsibility, current renewal date, version, and immutable status/renewal events.
- Receivables exclusively owns invoice amounts, balances, reported/confirmed payments, reversals, and financial events. `billing_status=billed` creates no financial row.
- Facts are orthogonal. Activity is `not_applicable` until installation and training are done. Billed may overlap active or inactive.
- Renewal reminders are derived from the one PostgreSQL `date`: T-2, T-1, today, and overdue. No Task, follow-up, Pipeline, Call, or reminder row is generated.

## IDENTITY AND IMPORT

Mutable names are not primary identity. A unique distributor reference is preferred; name-only preview is conservative and becomes ambiguous when multiple matches exist. Preview writes nothing, commit reconstructs authority server-side, revalidates every row, uses a stable operation/hash, and commits atomically. XLSX/XLS/CSV are bounded to 10 MB and 5,000 rows; transient bytes are not stored.

## AUTHORIZATION AND CONCURRENCY

Admin may read all and perform manual/import/reassignment/renewal mutations. Assigned active employees may read their own records and derived reminders only. The server derives actor and Admin capability; database functions independently enforce authority. Important changes require `expected_version`; stale writers receive conflict and canonical current state.

## RESOURCE AND SIDE-EFFECT BUDGET

Initial Admin screen uses one aggregate request and one 50-row explicit-column list request, plus bounded employee metadata. There is no polling, full-table hydration, Realtime subscription, binary evidence, or hot `select('*')`. Mutations may write only distributor account, event, operation receipt, and import batch tables. Protected-domain writes are a release failure.

## RELEASE

Migration `039_distributor_status_v1.sql` is additive source only until owner approval. It must be fresh-applied and tested on disposable PostgreSQL 17.6. Codex never applies it to production; production verification is read-only and uses no synthetic records.
