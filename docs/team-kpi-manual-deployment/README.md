# MANUAL DASHBOARD INSTRUCTIONS

Follow these steps exactly to deploy Team KPI Migration 026 manually via the Supabase Dashboard.

**WARNING: Manual SQL Editor execution does not update the repository migration-history table in the same way as CLI migration deployment.**
Keep migration 026 committed and record the manual deployment date. Do not later run `db push` blindly without reconciling migration history.

1. Sign in to Supabase Dashboard.
2. Open the project whose reference is: `gwfjkpsoaoherntwhdyf`
3. Verify the project name before running SQL.
4. Open SQL Editor.
5. Select **New query**.
6. Paste the complete contents of: `01_PRECHECK_READ_ONLY.sql`
7. Run it.
8. Review every result.
9. Stop when conflicts, missing source columns, or an already-existing function are unexpected.
10. When the precheck is approved, create another **New query**.
11. Paste the complete contents of: `02_APPLY_TEAM_KPI_026.sql`
12. Run it **once**.
13. Do not refresh or rerun while it is still executing.
14. When an error occurs:
    - Copy the exact error text.
    - Do not run the script again blindly.
    - Do not manually run only random remaining sections.
    - Stop and report the error.
15. When successful, create another **New query**.
16. Paste the complete contents of: `03_VERIFY_TEAM_KPI_026.sql`
17. Run its read-only verification section.
18. Run the optional PostgREST reload **only** if the application reports that the RPC is missing from the schema cache.
19. Save screenshots of:
    - Successful apply result.
    - Function verification.
    - Permission verification.
20. **Do not paste passwords, keys, or tokens anywhere in SQL Editor.**
