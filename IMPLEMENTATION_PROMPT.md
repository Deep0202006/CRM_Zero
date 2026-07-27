# INSTALL THE APPROVED ZERODATA TEAM KPI LIVE-DATA REPAIR

Act only as a careful senior integration and verification engineer.

The Principal Architect has already completed the Team KPI analysis and approved
implementation. Do not redesign, reinterpret, simplify, or replace it.

The package in the project root is:

`TEAM_KPI_LIVE_DATA_REPAIR_PACKAGE.zip`

## Fixed product goal

Keep the current Team KPI UI unchanged and make it show, for every active user and
selected India business date:

- calls;
- resolved client queries;
- completed mappings;
- completed normal tasks;
- completed spreadsheet targets;
- total completed work;
- latest activity;
- zero values for active users with no work.

The report must update after confirmed source-table changes and must not depend on
Activity Deck, KPI snapshots, or browser-side raw-table aggregation.

## Absolute rules

1. Do not change any visual design, global CSS, design token, page composition,
   card, chart, table, typography, spacing, or Funnel tab.
2. Do not change login, pipeline, visits, attendance, calls, support, mappings,
   tasks, My Day, authentication, or their business workflows.
3. Do not expose or read `.env` files, passwords, tokens, database URLs, or
   service-role credentials.
4. Do not use a service-role key in browser or server application code.
5. Do not run Supabase CLI, Docker, `db push`, `supabase link`, or PowerShell
   database commands. The operator will use Supabase Dashboard SQL Editor.
6. Do not push or merge `main`.
7. Do not install a new UI, state, chart, or data library.
8. Do not weaken RLS, TypeScript, lint, tests, or authorization.
9. Do not fabricate historical data.
10. Do not claim completion unless repository checks and preview smoke tests pass.

## Phase 1 — Safety checkpoint

From the existing CRM project root:

```powershell
git status --short
git branch --show-current
git switch -c fix/team-kpi-live-data-final
git add -A
git commit -m "chore: checkpoint before final Team KPI live-data repair"
```

When the branch already exists, remain on it rather than creating a duplicate.
When there are unrelated uncommitted changes, record them and do not overwrite
or discard them.

## Phase 2 — Extract outside the source tree

Extract the ZIP to a temporary folder outside the project. Do not copy the whole
`replacement-files` folder into the repository before checking the patch.

Verify these files exist in the extracted package:

- `TEAM_KPI_LIVE_DATA_REPAIR.patch`
- `PATCH_MANIFEST.txt`
- `STATIC_VERIFICATION.txt`
- `replacement-files/src/app/api/team-kpi/route.ts`
- `replacement-files/src/app/manager/kpi/page.tsx`
- `replacement-files/src/lib/teamKpi/aggregate.ts`
- `replacement-files/src/lib/teamKpi/contract.ts`
- `replacement-files/src/lib/teamKpi/serverReport.ts`
- `replacement-files/supabase/migrations/027_team_kpi_live_data_repair.sql`
- `MANUAL_SUPABASE/01_PRECHECK_READ_ONLY.sql`
- `MANUAL_SUPABASE/02_APPLY_TEAM_KPI_027.sql`
- `MANUAL_SUPABASE/03_VERIFY_READ_ONLY.sql`

Stop when any required file is missing.

## Phase 3 — Apply the exact approved patch

Copy only the patch file to the project root, then run:

```powershell
git apply --check --ignore-space-change --ignore-whitespace .\TEAM_KPI_LIVE_DATA_REPAIR.patch
git apply --ignore-space-change --ignore-whitespace .\TEAM_KPI_LIVE_DATA_REPAIR.patch
```

The check must pass before applying.

When the check fails:

- do not invent a merge;
- do not copy the complete repository;
- compare the exact conflicting file with its matching file under
  `replacement-files`;
- preserve unrelated changes;
- apply only the approved Team KPI changes;
- list every conflict and every manual line-level resolution.

The approved changed paths are exactly those in `PATCH_MANIFEST.txt`. Restore any
unrelated changed file.

Remove temporary delivery artifacts from the repository working tree after the
patch is applied. Do not commit the ZIP, patch, or extracted package.

## Phase 4 — Architectural assertions

Verify all of the following in the installed source:

- The browser page calls exactly one `/api/team-kpi?date=...` request.
- The browser page does not query `users`, `call_logs`, `client_queries`,
  `mapping_requests`, `tasks`, or KPI snapshot tables directly.
- The server route verifies the Supabase access token.
- The server route verifies the exact `admin` capability.
- The server route prefers `get_team_kpi_daily` and uses server-side paginated
  RLS aggregation only as a degraded fallback.
- No service-role key is referenced.
- All active users are constructed independently of work rows.
- Zero-work users remain in the report.
- Calls exclude synthetic pipeline arrow records.
- Client queries use `resolved_by` with a legacy `assigned_to` fallback.
- Mappings use `mapped_by` and `completed_at`.
- Normal tasks use one completion event per task/day and legacy `completed_at`
  only when no completion history exists.
- Reopened-task attribution can fall back to the task assignee when the history
  actor is missing.
- Spreadsheet targets are included in Tasks done.
- India date filtering uses half-open Asia/Kolkata boundaries.
- Totals are validated against row components.
- Realtime only triggers a debounced authoritative refresh; it never increments
  counters locally.
- A visible-tab one-minute refresh remains as a lightweight degraded fallback.

Do not continue when an assertion fails.

## Phase 5 — Repository verification

Run separately:

```powershell
npm ci
npm run lint
npm test -- --runInBand
npm run build
git diff --check
```

Record the exact exit code and test count for every command.

Do not:

- use `npm audit fix --force`;
- alter package versions to bypass a network problem;
- delete tests;
- weaken assertions;
- add `@ts-ignore`;
- suppress build or lint errors.

When `npm ci` fails only because the package registry is temporarily unavailable,
record the exact network error and retry later. Do not report code verification
as complete until all commands pass locally.

## Phase 6 — Commit feature branch only

When repository checks pass:

```powershell
git add -A
git commit -m "fix: make Team KPI show authoritative live daily data"
git status --short
```

Do not push `main`. Pushing the feature branch for a Vercel Preview is permitted
only after the operator approves.

## Phase 7 — Manual Supabase handoff

Do not execute database SQL yourself.

Tell the operator to open Supabase Dashboard for the CRM project and use SQL
Editor in this exact order:

1. Run `MANUAL_SUPABASE/01_PRECHECK_READ_ONLY.sql`.
2. Stop if any required column shows `MISSING` or an unexpected function conflict
   exists.
3. Back up the database.
4. Run the complete `MANUAL_SUPABASE/02_APPLY_TEAM_KPI_027.sql` once.
5. Run `MANUAL_SUPABASE/03_VERIFY_READ_ONLY.sql`.
6. Run `NOTIFY pgrst, 'reload schema';` only if the preview reports a PostgREST
   function/schema-cache miss.

Migration 027 is required for guaranteed complete all-user data. The application
fallback is deliberately limited by existing source-table RLS.

Do not paste only the function body. The complete SQL also installs narrow
indexes and idempotent Realtime publication membership.

## Phase 8 — Vercel Preview smoke test

Use the feature branch Preview deployment, not production.

Test with a real administrator session:

1. Open `/manager/kpi` for the current India date.
2. Confirm every active human user appears, including a known zero-work user.
3. Compare one selected user/day against raw retained source records.
4. Confirm one real call counts exactly once.
5. Confirm a synthetic pipeline arrow record does not count as a call.
6. Confirm a resolved client query is credited to its resolver.
7. Confirm a completed mapping is credited to `mapped_by`.
8. Confirm a normal completed task counts once.
9. Confirm a completed spreadsheet target counts once.
10. Confirm Total work equals the four displayed metrics.
11. Select at least one retained past date and verify its raw records.
12. Complete one controlled work item and verify a debounced live refresh.
13. Refresh the browser and verify values persist.
14. Sign out and sign in again and verify values persist.
15. Confirm an ordinary user cannot retrieve full-team KPI data.
16. Confirm no console, hydration, network, authorization, schema-cache, or
    duplicate Realtime-channel error exists.

Do not use client names, employee names, or private data in the final report.

## Historical-data boundary

The supplied repository contains migrations 014 and 015 that physically delete
business records before 8 July 2026. The repaired KPI shows every retained daily
record. It cannot reconstruct deleted history. Dates before the retained boundary
require a verified external backup and a separately approved restoration plan.

## Final acceptance

The feature is complete only when:

- the existing Team KPI visual design is unchanged;
- every active user appears;
- zero-work users appear with zero values;
- current and retained past dates work;
- every metric matches its authoritative source;
- Total work is exact;
- last activity is correct;
- Realtime refresh works without double counting;
- refresh/login persistence works;
- ordinary users are denied;
- migration 027 is applied and verified;
- lint, tests, build, and diff checks pass;
- no other CRM workflow changed.

## Required final report

Return exactly:

### Status

COMPLETE / PARTIALLY COMPLETE / BLOCKED

### Files installed

List every added and modified repository path.

### Repository verification

- npm ci
- lint
- Jest tests and count
- production build
- git diff check

### Supabase manual SQL

- Precheck prepared
- Migration 027 applied by operator: Yes/No
- Verification result
- RPC exists
- authenticated execute
- anon/public execute denied
- Realtime source tables

### KPI verification

- all active users
- zero-work user
- calls
- synthetic-call exclusion
- client queries
- mappings
- normal tasks
- spreadsheet targets
- totals
- last activity
- India date
- retained historical date
- live refresh
- ordinary-user denial

### Unchanged workflows

Confirm no changes to login, pipeline, visits, attendance, calls, support,
mappings, tasks, My Day, global CSS, or design tokens.

### Remaining issues

Include exact error and reproduction. Do not hide a failed source behind “no data.”

### Git

- branch
- commit
- final status
- main merged: No
