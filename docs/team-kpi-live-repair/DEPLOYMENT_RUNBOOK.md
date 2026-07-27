# Team KPI live-data deployment runbook

## 1. Repository checks

Run:

```bash
npm ci
npm run lint
npm test -- --runInBand
npm run build
git diff --check
```

Do not deploy if any command fails.

## 2. Preview deployment

Deploy the feature branch to a Vercel Preview after manually applying migration 027 to the same Supabase project used by the preview. The server API fallback is a degraded safety path and is not the release authority for complete all-user data.

Verify with an administrator account:

1. Open `/manager/kpi`.
2. Select today in India.
3. Confirm every active user appears, including zero-work users.
4. Compare one user's calls, resolved queries, completed mappings and completed tasks against the corresponding source records.
5. Select at least one past date after the retained-data cutoff.
6. Complete one new work item and verify the report refreshes within realtime or the one-minute fallback.
7. Confirm an ordinary user receives access denied.
8. Confirm there are no console, network, hydration or API errors.

## 3. Required manual Supabase SQL

Apply migration 027 once through the correct Supabase project SQL Editor before approving the preview. Do not use PowerShell, Docker, `supabase link`, or `db push`.

1. Back up the database.
2. Review `supabase/migrations/027_team_kpi_live_data_repair.sql`.
3. Paste the complete file into a new Supabase SQL Editor query and run once.
4. Run `supabase/manual/verify_027_team_kpi_live_data_repair.sql`.
5. Run `NOTIFY pgrst, 'reload schema';` only when the application reports a schema-cache miss.
6. Do not rewrite migration 027 after applying it.

## 4. Historical limitation

Migrations 014 and 015 delete records before 8 July 2026. Dates before the retained data boundary can show zero because the original domain records no longer exist. Do not manufacture or backfill figures without a verified external backup.

## 5. Production

Merge only after preview verification. After production deployment, repeat the administrator, ordinary-user, current-day, past-day and live-refresh checks.
