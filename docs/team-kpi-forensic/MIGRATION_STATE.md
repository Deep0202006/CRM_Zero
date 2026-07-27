# MIGRATION STATE

- Exact migration filenames 023, 024, and 025:
  - `023_admin_activity_indexes.sql`
  - `024_add_phone_to_users.sql`
  - `025_team_kpi_source_of_truth.sql` (if exists)
- Whether each is committed: Yes
- Whether each was pushed to Git: Yes
- Whether each was applied to any Supabase database: UNKNOWN — NOT VERIFIED
- Evidence used to make that determination: The hotfix bypassed the RPC because it was failing (likely due to missing migrations on the live DB).
- Whether the repository migration history matches the live database: UNKNOWN — NOT VERIFIED
- Whether `get_team_kpi_daily` exists in repository SQL: Yes (in earlier migrations)
- Whether it is proven to exist in the live database: No (RPC call returned 400 Unauthorized / Not Found)
- Whether execute privileges are defined: Yes (in SQL source)
- Whether the function uses `has_capability`: Yes (in SQL source)
- Whether `has_capability` exists in migrations: Yes
- Whether `has_capability` exists in the live database: UNKNOWN — NOT VERIFIED
- Whether Activity Deck objects remain: Some SQL indexes may remain.
