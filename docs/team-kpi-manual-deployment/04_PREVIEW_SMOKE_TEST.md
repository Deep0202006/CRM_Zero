# PREVIEW SMOKE TEST

After manual SQL application, test the Vercel Preview deployment from the `fix/team-kpi-architect-repair` branch.

## Prerequisites
- Preview build uses commit f53e2e4 (or its approved successor).
- Manual SQL deployment (`02_APPLY_TEAM_KPI_026.sql`) has been successfully executed in the Supabase Dashboard.

## Verification Checklist

- [ ] Team KPI page (`/manager/kpi`) opens without function-not-found error.
- [ ] All active human users appear in the table.
- [ ] A zero-work user appears with zero values (not hidden).
- [ ] One real call is counted exactly once.
- [ ] Synthetic pipeline records are excluded from Calls.
- [ ] A resolved client query is credited to its resolver.
- [ ] A completed mapping is credited to its completing user.
- [ ] A normal completed task is counted once.
- [ ] A completed spreadsheet target is counted once.
- [ ] The Total column exactly equals the sum of the four individual metrics.
- [ ] The India date boundary (Asia/Kolkata) is applied correctly.
- [ ] Changing the date picker does not show stale results from the previous date.
- [ ] Realtime causes exactly one debounced refresh on relevant activity.
- [ ] Manual refresh preserves confirmed values.
- [ ] Logout and login preserve confirmed values.
- [ ] Ordinary user cannot access complete team KPI (access denied / unauthorized).
- [ ] No console, hydration, network, or realtime error appears in developer tools.

## Compare with Raw Database Counts
For one selected user and day, manually verify the report numbers against read-only raw source tables in the Supabase SQL editor:
- `call_logs`
- `client_queries`
- `mapping_requests`
- `tasks`
- `allocated_targets`

*(Do not include personal names or client data in the final deployment report.)*
