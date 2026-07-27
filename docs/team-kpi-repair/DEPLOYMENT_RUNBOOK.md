# Team KPI repair deployment runbook

## Release order

The database migration must be deployed before the matching frontend. Do not deploy only one side.

1. Create a database backup in Supabase.
2. Confirm the project reference is the same Supabase project used by Vercel production variables.
3. Confirm migration files 023–025 are already represented in remote migration history. Do not use `--include-all` blindly.
4. Review `supabase/migrations/026_team_kpi_repair.sql`.
5. Run:

   ```powershell
   npx supabase migration list
   npx supabase db push --dry-run
   ```

6. The dry run must list only the expected pending migration(s), normally `026_team_kpi_repair.sql`. Stop on any unexpected historical migration.
7. Apply:

   ```powershell
   npx supabase db push
   npx supabase migration list
   ```

8. Reload the PostgREST schema cache when the RPC is not visible immediately:

   ```sql
   NOTIFY pgrst, 'reload schema';
   ```

9. Run `supabase/manual/verify_026_team_kpi_repair.sql` with safe test users and rollback where indicated.
10. Deploy the application branch to a Vercel Preview deployment.
11. Test `/manager/kpi` as an administrator for a known India date and compare counts against raw source records.
12. Create one call, resolve one client query, complete one mapping, complete one normal task, and complete one spreadsheet target. Confirm one debounced KPI refresh and exact counts.
13. Confirm an ordinary user cannot execute the RPC or view Team KPI.
14. Merge and deploy to production only after preview verification.

## Production smoke test

- All active users appear, including users with zero work.
- Calls match real call logs and exclude synthetic pipeline arrow entries.
- Resolved queries use resolver attribution.
- New mapping completion is credited to the completing user.
- Normal tasks and spreadsheet targets both contribute to Tasks done.
- India date boundaries are correct near midnight.
- Refresh, tab visibility, and realtime changes do not double count.
- Browser console has no RPC, authorization, schema-cache, or realtime errors.

## Rollback

- Frontend: redeploy the previous Vercel deployment.
- Database: do not edit or delete migration 026 after production use. Apply a new forward-fix migration if a database correction is required.
- The legacy snapshot tables remain intact; migration 026 does not delete historical KPI data.
