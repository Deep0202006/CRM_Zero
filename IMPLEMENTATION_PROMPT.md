# APPLY THE PRINCIPAL-ARCHITECT TEAM KPI REPAIR

Act as a careful senior integration engineer. The architecture and code changes are already approved in this package. Your job is to apply them exactly, verify them, deploy the database migration safely, and prepare a Vercel preview. Do not redesign or reinterpret the feature.

## 1. Non-negotiable rules

- Do not print or read `.env`, `.env.local`, `.env.production`, database passwords, service-role keys, JWTs, Git credentials, or Vercel tokens.
- Do not run commands containing a password on the command line.
- Do not push directly to `main`.
- Do not replace unrelated files.
- Do not modify login, pipeline, Field Visits, global CSS, design tokens, navigation styling, or unrelated CRM workflows.
- Do not return to browser-side raw aggregation.
- Do not use `users.role`; that column does not exist.
- Do not use `kpi_snapshots` or `kpi_daily_snapshot` as Team KPI authority.
- Do not weaken RLS or add a service-role key to browser code.
- Do not edit historical migrations 023, 024, or 025.
- If a migration numbered 026 already exists and differs, stop and report the conflict instead of overwriting it.

## 2. Create a safe branch

From the CRM project root:

```powershell
git status --short
git branch --show-current
git switch -c fix/team-kpi-architect-repair
git add -A
git commit -m "chore: checkpoint before Team KPI architect repair"
```

If the checkpoint has nothing to commit, continue.

## 3. Put the delivery package in the project root

The package must contain:

- `TEAM_KPI_ARCHITECT_REPAIR.patch`
- `replacement-files/`
- this instruction file
- the architect analysis and static verification

Do not copy the whole replacement-files folder over the repository yet.

## 4. Apply the patch first

Run:

```powershell
git apply --check --ignore-space-change --ignore-whitespace .\TEAM_KPI_ARCHITECT_REPAIR.patch
```

When the check passes:

```powershell
git apply --ignore-space-change --ignore-whitespace .\TEAM_KPI_ARCHITECT_REPAIR.patch
```

When the check fails:

1. Do not run `git apply --reject` blindly.
2. Inspect the reported files.
3. Use `replacement-files` only as the approved source for those exact files.
4. Preserve unrelated changes already present in the current repository.
5. Manually merge only the changed Team KPI and mapping-attribution sections.
6. Do not simplify the architecture.

The expected changed files are listed in `PATCH_MANIFEST.txt`.

## 5. Architectural invariants after applying

Verify all of these:

### Team KPI frontend

- `/manager/kpi` makes one call to `supabase.rpc("get_team_kpi_daily", { target_date })`.
- It does not query users, calls, queries, mappings, or tasks directly from the browser.
- It uses `getCurrentISTDate()`.
- It validates the RPC response through Zod.
- It retains the last confirmed report when a background refresh fails.
- It protects against stale request responses.
- It refreshes on manual action, tab visibility, and debounced relevant realtime events.
- It shows all active users, including zero-work users.
- It shows Calls, Client queries, Mappings, Tasks done, Total work, Role, and Last activity.
- It uses only the existing CRM components, tokens, layout, and visual language.

### Database migration 026

- The function is admin-only.
- It derives authorization from `auth.uid()` and `user_capabilities`.
- It has a fixed search path.
- It does not depend on `public.has_capability`.
- It does not reference `users.role`.
- It uses Asia/Kolkata half-open date boundaries.
- It aggregates calls, resolved queries, completed mappings, immutable normal-task completion events, legacy task fallback, and completed spreadsheet targets.
- It excludes synthetic pipeline arrow call logs.
- It includes active users with zero work.
- It revokes execution from PUBLIC and anon.
- It keeps historical snapshot data but retires obsolete snapshot triggers and active snapshot synchronization.
- It adds `mapping_requests.requested_by` and preserves the requester separately from the completion actor.

### Mapping workflow

- New mapping requests preserve `requested_by`.
- Existing `mapped_by` behavior remains compatible while pending.
- Completing a mapping sets `mapped_by` to the authenticated completing user and sets `completed_at`.
- No visual mapping-page redesign occurs.

## 6. Inspect the exact diff

Run:

```powershell
git diff --check
git diff --stat
git diff --name-only
```

Fail the task if unrelated visual or workflow files changed.

Search for forbidden Team KPI patterns:

```powershell
Select-String -Path .\src\app\manager\kpi\page.tsx -Pattern 'supabase\.from\('
Select-String -Path .\src\app\manager\kpi\page.tsx -Pattern 'kpi_snapshots|kpi_daily_snapshot|users\.role|u\.role'
Select-String -Path .\supabase\migrations\026_team_kpi_repair.sql -Pattern 'users\.role|u\.role|public\.has_capability'
```

All three searches must return no forbidden match.

## 7. Install and verify repository code

Run separately:

```powershell
npm ci
npm run lint
npm test -- --runInBand
npm run build
git diff --check
```

Do not continue after a failure.

Fix only the exact defect. Do not disable tests, suppress TypeScript, add `@ts-ignore`, add unexplained `any`, or remove architecture checks.

Required focused tests include:

- `teamKpiContract.test.ts`
- `teamKpiMigration.test.ts`
- `teamKpiPageContract.test.ts`
- `teamKpiWorkflowAttribution.test.ts`
- `teamKpiLegacyRetirement.test.ts`

## 8. Commit the code before database deployment

```powershell
git add -A
git commit -m "fix: install authoritative Team KPI reporting"
```

Do not push `main`.

## 9. Safely inspect Supabase migration state

Do not display credentials.

Run:

```powershell
npx supabase status
npx supabase migration list
npx supabase db push --dry-run
```

Acceptable dry-run states:

- Only migration 026 is pending; or
- Migration 025 followed immediately by 026 is pending, with no older unexpected migration. Migration 026 replaces the broken function created by 025.

Stop when:

- Any unexpected migration older than 025 is pending.
- Remote and local histories conflict.
- Migration 026 already exists remotely with different contents.
- The linked Supabase project is not the production project used by the CRM.

Do not use `--include-all`, `migration repair`, or history changes without a separate architectural review.

## 10. Apply migration safely

After the dry run is correct:

```powershell
npx supabase db push
npx supabase migration list
```

Do not put the database password in the command itself. Use the already authenticated CLI or an interactive secure prompt.

If PostgREST reports the function is not found after deployment, run in Supabase SQL Editor:

```sql
NOTIFY pgrst, 'reload schema';
```

Then execute the non-destructive checks in:

`supabase/manual/verify_026_team_kpi_repair.sql`

Use only safe test users. Do not expose personal data in the report.

## 11. Push a preview branch

```powershell
git push -u origin fix/team-kpi-architect-repair
```

Do not push directly to `main`.

Use the Vercel Preview deployment created for this branch.

## 12. Required preview tests

Test as a real admin on a known India date:

1. All active users appear.
2. A zero-work user appears with zero values.
3. Add one real call; Calls increases by one after sync/realtime refresh.
4. Resolve one client query; Client queries increases for the resolver.
5. Complete one mapping by a different user than the requester; the completing user receives the count.
6. Complete one normal task; Tasks done increases once.
7. Complete one spreadsheet-allocated target; Tasks done increases once.
8. Synthetic pipeline arrow logs do not increase Calls.
9. Refresh and sign in again; values remain unchanged.
10. An ordinary user cannot access the RPC or Team KPI page.
11. No console, RPC, schema-cache, realtime, or hydration errors appear.
12. India date behavior is correct near midnight.

Compare at least one user/day against raw database records using the verification SQL.

## 13. Production release

Merge to `main` only after the preview tests pass and the user approves the preview.

Do not rewrite migration 026 after it has been applied. Any later correction must use migration 027 or the next available forward migration.

## 14. Final report

Return exactly:

### Status

- COMPLETE
- PARTIALLY COMPLETE
- BLOCKED

### Code verification

- Patch applied
- Lint
- Unit tests
- Production build
- Git diff check

### Database

- Linked project reference, without credentials
- Dry-run migrations
- Migration 026 applied: Yes/No
- PostgREST cache reloaded: Yes/No
- Verification SQL result

### KPI source verification

- Calls
- Client queries
- Mappings
- Normal tasks
- Spreadsheet targets
- Zero-work users
- India date
- Synthetic call exclusion

### Security

- RPC admin authorization
- Ordinary-user denial
- PUBLIC execute revoked
- Service-role browser key added: No
- Secrets printed: No

### Deployment

- Branch
- Commit
- Preview URL
- Preview smoke result
- Main merged: Yes/No

### Remaining issues

Include exact error and reproduction. Do not claim completion when any required test fails.
