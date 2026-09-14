# B–D manual Supabase activation packet

Status: **prepared; new pre/postcheck CI pending; not Owner-applied or Production-verified**.
Do not execute this packet until the complete PR114 acceptance and required
final-head CI are reviewed. This document is not an application certificate.
The Owner-applied repository boundary remains **54/54**.

## Exact files and integrity

Migration source is unchanged from reviewed implementation commit
`0cc5e29a3b09ca3e4306c80a9cd4b495b6b8c226`. Use all three files from the
same final reviewed PR114 head, never a mixture of downloaded revisions.
These SHA-256 values identify the UTF-8, LF repository bytes:

| Order | Repository file | SHA-256 |
|---|---|---|
| 1 | `supabase/manual/precheck_055_crm_bcd_readers.sql` | `fbe7f94e448a903ae8f24a77cd44681e88237fee53af3968fc3bc50cadc0b5de` |
| 2 | `supabase/migrations/055_crm_bcd_readers.sql` | `f4a4c2cc00aa55b30fb0dd791780020a25b5b372b09a1df13d802d3391ea0223` |
| 3 | `supabase/manual/verify_055_crm_bcd_readers.sql` | `ca3bcbbfda858104524e2d5c3ec8f63ebf5567d1c954c371a52a497df367dd26` |

Download the raw files at the final reviewed commit, not rendered Markdown or
line-numbered HTML. Do not alter their contents or paste CI bootstrap/fixture SQL.
No Supabase CLI, migration metadata table, local database or staging project is
needed. The SQL Editor files contain ordinary SQL only.

## Owner operation, after final release readiness

1. Confirm the intended Production Supabase project and final reviewed PR114
   commit. Check all six required jobs at that exact head. Preserve the prior
   54/54 application evidence; no database action is authorized by CI alone.
2. Paste and run the **entire precheck** in SQL Editor. Expected result:
   `BCD055_PRECHECK_PASS_NOT_APPLIED`. Any exception means STOP. In particular,
   `BCD055_FUNCTION_COLLISION_STOP` means one or more new names already exist;
   do not drop them, retry individual CREATE statements or assume application.
3. After successful precheck and the final release decision, paste and run the
   **entire migration055 transaction**, from `begin` through `commit`. It creates
   only eight read/helper functions, restricts execution and requests a schema
   cache reload. It does not modify business rows, applied001–054 or a ledger.
4. Run the **entire postcheck**. Expected result:
   `BCD055_POSTCHECK_PASS_OWNER_EVIDENCE_REQUIRED`. Save the actual project,
   execution time, reviewed commit, file hashes and SQL Editor results/errors.
   Supply these through the established Owner certification workflow. Only
   actual Owner evidence permits a later supported ledger/certificate update.
5. If that update changes the PR head, require checks for the resulting head
   before the protected **Owner manual merge**. Verify the deployed commit
   afterward through the authorized observation route, then inspect Visits
   register/analysis/export and Pipeline ordinary/inspection reads. Preserve
   existing records/actions if analytics are unavailable.

Until steps4–5 produce evidence, report **prepared / disposable-CI-tested**
separately from **Owner-applied / Production-verified**. Do not mark fully live.

## New objects and compatibility

`crm_visit_matches_v1` is an immutable invoker scalar predicate. The seven
stable invoker readers are `crm_visit_events_v1`, `crm_visit_register_v1`,
`crm_visit_export_v1`, `crm_visit_export_erp_v1`,
`crm_visit_representatives_v1`, `crm_pipeline_register_v1`, and
`crm_pipeline_history_v1`. Exact signatures/results are checked in the
postcheck. All eight deny PUBLIC, anon and authenticated execution; only the
existing service role receives an explicit execute grant. Existing server
routes still enforce active-account/Admin or self scope before source reads.

No new write boundary, historical-credit ledger, coverage watermark or index
is introduced. The packet verifies the existing supporting index definitions,
Mapping054 lifecycle constraints, creator policies, RLS and attached guards.
Disposable CI compares protected function/trigger/policy/constraint/index/RLS
catalogs before and after055 and tests missing/colliding reader states.
The independent full054 and domain database proofs remain required.

SQL-before-app is the intended additive release order: old app paths do not
depend on the new functions. Before activation, new unavailable-reader states
must remain explicit; ordinary unfiltered Pipeline has its existing bounded
fallback. No filtered or analytical result may silently become a broad fallback.

## Bounds and failure handling

The migration DDL statement timeout is60seconds, with a5second lock timeout.
Seven reader functions configure a7second SQL statement timeout; application
reports enforce an8second shared transport deadline. These are distinct limits.
The scalar predicate has no function-level SET so PostgreSQL can inline it.
The disposable PostgREST fixture tests timeout behavior. Production gateway
hoisting/configuration is **unverified**; catalog settings alone do not establish
its effective timeout. No global ALTER ROLE or Production stress test is allowed.

A migration error leaves application state unknown until verified. Stop and
retain the exact error; do not blindly rerun fragments or advance the ledger.
If a new reader fails after activation, prefer application rollback or keeping
analytics unavailable while retaining additive database objects. Existing
business/history records and durable offline intent remain intact. Any database
correction is a separately reviewed forward operation, never editing an applied
migration or deleting history.
