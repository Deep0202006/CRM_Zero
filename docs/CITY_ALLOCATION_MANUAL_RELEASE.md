# City allocation manual release

Keep PR #1 as a draft until the database migration is manually verified.

1. Take a production database backup/export outside this repository.
2. In the Supabase SQL Editor, paste and run `supabase/migrations/018_harden_city_task_allocation.sql`.
3. Run `supabase/manual/verify_018_city_task_allocation.sql` as read-only SQL.
4. Confirm the allocation function exists, is SECURITY DEFINER with the restricted search path, the compound index exists, `authenticated` can execute the function, and `anon` cannot.
5. Only after these checks pass, mark PR #1 ready for review.
6. Confirm the Vercel check succeeds for the final PR commit.
7. Squash-merge PR #1 into `main` through GitHub.
8. Monitor the Vercel production deployment.
9. Run a small approved production smoke test: parse, map, allocate, verify My Day, and complete one target.
10. If allocation must be stopped without deleting data, run `supabase/manual/disable_018_city_task_allocation.sql`. This revokes execution only; it does not delete targets, batches, indexes, or the function.

Do not merge application code before the migration verification succeeds.
