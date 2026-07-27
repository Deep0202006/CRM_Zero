# Team KPI Event-Ledger Deployment Runbook

## Required order

1. Install the code patch on a feature branch.
2. Run lint, Jest, production build, and `git diff --check`.
3. In Supabase SQL Editor, run `precheck_028_team_kpi_event_ledger.sql`.
4. Stop when any required source column is `MISSING`.
5. Back up the database.
6. Run `apply_028_team_kpi_event_ledger.sql` once.
7. Run `verify_028_team_kpi_event_ledger.sql`.
8. Every reconciliation `difference` must be zero.
9. Deploy a Vercel Preview from the feature branch.
10. Verify current date and at least two retained historical dates.
11. Complete one controlled work item for each metric and confirm one live refresh.
12. Verify a non-admin user is denied.
13. Merge to production only after preview approval.

## SQL Editor rules

- Run the complete apply script, not isolated fragments.
- Do not rerun after an error without reviewing the exact error.
- Do not use service-role credentials in the browser.
- Run `NOTIFY pgrst, 'reload schema';` only when PostgREST reports the v3 RPC is missing from schema cache.

## Smoke test

For one known admin date, compare Team KPI counts to read-only source counts. Then verify:

- all active users are present;
- zero-work users show zeros;
- calls exclude synthetic arrow outcomes;
- client queries use resolver/assignee fallback;
- mappings use `mapped_by` and `completed_at`;
- task history and allocated targets count once;
- refresh and re-login preserve values;
- no duplicate realtime channel or network error appears.

## Historical limitation

Only retained source records can be backfilled. Records previously physically deleted by older cleanup migrations require a verified backup and a separately approved restoration process.
