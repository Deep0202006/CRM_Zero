# Manual Supabase package

1. Run `01_PRECHECK_READ_ONLY.sql`. Stop when `compatible` is false or migration-030 objects unexpectedly exist.
2. Confirm a current backup.
3. Run `02_APPLY.sql` once in the Supabase SQL Editor. It exactly matches the branch migration.
4. Run `03_VERIFY_SINGLE_RESULT.sql`.
5. Run `04_RECONCILE_COUNTS.sql`; investigate every non-zero difference.
6. If PostgREST does not discover new functions, run separately: `NOTIFY pgrst, 'reload schema';`

The package contains no credentials, does not manipulate migration history, does not truncate source data, and does not fabricate history. Record manual application in the operator deployment log before any later migration tooling is used.
