# INSTALL TEAM KPI CTO EVENT-LEDGER REPAIR

Act only as a careful senior integration and release engineer.

The approved package is:

`TEAM_KPI_CTO_ROOT_REPAIR_PACKAGE.zip`

The goal is fixed:

- preserve the existing Team KPI UI;
- show every active user;
- show zero-work users;
- show retained current and historical daily work;
- update live after confirmed calls, resolved client queries, completed mappings,
  completed tasks, and completed spreadsheet targets;
- never depend on Activity Deck, KPI snapshots, browser raw-table aggregation, or
  an RLS-limited fallback;
- do not change any other CRM workflow.

## Absolute restrictions

Do not redesign Team KPI.
Do not change global CSS or design tokens.
Do not modify login, pipeline, visits, attendance, calls, support, mappings,
tasks, My Day, or Funnel behavior.
Do not read or print environment files.
Do not use a service-role key in application code.
Do not use Supabase CLI, Docker, database passwords, or `db push`.
Do not push or merge `main`.
Do not apply database SQL yourself.
Do not weaken RLS, lint, TypeScript, or tests.
Do not create a second ledger or parallel KPI implementation.

## 1. Safety checkpoint

From the current repository root:

```powershell
git status --short
git branch --show-current
git switch -c fix/team-kpi-cto-event-ledger
git add -A
git commit -m "chore: checkpoint before Team KPI CTO ledger repair"
```

When the branch already exists, remain on it. Do not discard unrelated changes.

## 2. Extract outside the repository

Extract the ZIP to a temporary directory outside the source tree.

Verify it contains:

- `TEAM_KPI_CTO_ROOT_REPAIR.patch`
- `PATCH_MANIFEST.txt`
- `replacement-files/supabase/migrations/028_team_kpi_event_ledger.sql`
- `MANUAL_SUPABASE/01_PRECHECK_READ_ONLY.sql`
- `MANUAL_SUPABASE/02_APPLY_TEAM_KPI_028.sql`
- `MANUAL_SUPABASE/03_VERIFY_READ_ONLY.sql`
- `ARCHITECT_ANALYSIS.md`
- `DEPLOYMENT_RUNBOOK.md`

Stop when anything is missing.

## 3. Apply only the approved patch

```powershell
git apply --check --ignore-space-change --ignore-whitespace <temporary-path>\TEAM_KPI_CTO_ROOT_REPAIR.patch
git apply --ignore-space-change --ignore-whitespace <temporary-path>\TEAM_KPI_CTO_ROOT_REPAIR.patch
```

When the patch conflicts because the previous 027 package was not installed:

1. Stop.
2. Report which approved path conflicts.
3. Do not invent a hybrid implementation.
4. First install the approved 027 Team KPI API foundation, then retry this 028
   patch.

When only harmless line drift exists, use the matching replacement file for that
exact path and preserve unrelated current changes.

Do not copy the complete replacement-files tree over the repository.

## 4. Architectural assertions

Confirm:

- `/manager/kpi` still uses the existing layout and components.
- The browser calls one `/api/team-kpi?date=...` request.
- The API calls `get_team_kpi_daily_v3`.
- The API does not call `loadTeamKpiServerReport`.
- The API does not silently query operational tables when the RPC fails.
- Missing migration returns `TEAM_KPI_LEDGER_NOT_INSTALLED`.
- Database failure returns `TEAM_KPI_DATABASE_FAILED`.
- Zero active users returns `TEAM_KPI_NO_ACTIVE_USERS` with a non-sensitive health check.
- The page subscribes only to `team_work_events`, `users`, and `user_capabilities`.
- The page does not subscribe directly to calls, queries, mappings, tasks,
  history, or allocated targets.
- No service-role credential is referenced.

## 5. Repository verification

Run separately:

```powershell
npm ci
npm run lint
npm test -- --runInBand
npm run build
git diff --check
```

Record exact exit codes and test counts.

Do not suppress or weaken failures. Do not use `npm audit fix --force`.

## 6. Commit feature branch only

After all repository checks pass:

```powershell
git add -A
git commit -m "fix: add durable Team KPI work-event ledger"
git status --short
```

Do not merge or push `main`.

## 7. Manual Supabase handoff

Tell the operator to use Supabase Dashboard → SQL Editor:

1. Run `MANUAL_SUPABASE/01_PRECHECK_READ_ONLY.sql`.
2. Every required source column must say `PRESENT`.
3. Review retained source counts.
4. Back up the database.
5. Run `MANUAL_SUPABASE/02_APPLY_TEAM_KPI_028.sql` once.
6. Run `MANUAL_SUPABASE/03_VERIFY_READ_ONLY.sql`.
7. Every source reconciliation `difference` must equal zero.
8. Confirm v3 and health functions exist.
9. Confirm PUBLIC and anon execute are false and authenticated execute is true.
10. Run `NOTIFY pgrst, 'reload schema';` only if the preview reports a PostgREST
    schema-cache miss.

Do not apply only parts of migration 028.

## 8. Vercel Preview verification

Deploy this feature branch to Vercel Preview after SQL verification.

Use a real admin session and verify:

1. All active users appear.
2. A known zero-work user appears with zeros.
3. Today loads.
4. At least two retained past dates load.
5. A real call appears once.
6. A synthetic arrow call does not appear.
7. A resolved query is credited once.
8. A completed mapping is credited once.
9. A normal task completion appears once.
10. A spreadsheet target completion appears once.
11. Total equals the four metrics.
12. Last activity is correct.
13. One controlled work action causes one debounced refresh.
14. Refresh and re-login preserve results.
15. A normal user cannot read full-team KPI.
16. No console, network, schema-cache, hydration, or duplicate-channel errors occur.

Do not merge production until every check passes.

## Required final report

Return exactly:

### Status

COMPLETE / PARTIALLY COMPLETE / BLOCKED

### Code verification

- npm ci
- lint
- Jest
- build
- git diff check

### Database operator handoff

- precheck result
- migration 028 applied by operator: Yes/No
- reconciliation differences
- v3 function
- health function
- permissions
- realtime ledger

### KPI result

- active users
- zero-work user
- today
- historical dates
- calls
- client queries
- mappings
- normal tasks
- spreadsheet targets
- total
- last activity
- live refresh
- non-admin denial

### Change boundary

- Team KPI visual redesign: No
- Other CRM workflows changed: No
- Global CSS changed: No
- Service-role browser key added: No

### Git

- branch
- commits
- final status

Do not claim COMPLETE until migration 028, reconciliation, Preview runtime, and all
repository checks have passed.
