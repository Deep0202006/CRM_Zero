# Team KPI architect repair

## Confirmed root causes in the supplied repository

1. The browser hotfix selects `users.role`, but the canonical `users` contract contains no `role` column. Supabase rejects that query and the page converts the failure into an empty table.
2. The hotfix discards every Supabase query error returned by `Promise.all`, so RLS, missing-column, and schema failures look like “no data”.
3. It depends on multiple browser queries and client-side joins, exposing the report to RLS differences, row limits, partial responses, and request races.
4. It counts normal tasks by `due_date`, not by the day work was completed, and it omits completed spreadsheet-allocated targets from My Day.
5. Migration 025 also selects the nonexistent `users.role` column and depends on the historically inconsistent `has_capability` helper.
6. Mapping requests set `mapped_by` at creation time, so a mapping completed by another user is credited to the requester instead of the actual completer.
7. Synthetic pipeline gate notes stored in `call_logs` can inflate call totals unless explicitly excluded.
8. The selected default date used UTC instead of the India business date.
9. No Team KPI-specific realtime refresh existed, and errors were converted to an empty report.

## Permanent lightweight architecture

- Migration 026 installs one admin-only `SECURITY DEFINER` database function with an explicit capability check and fixed search path.
- The function aggregates directly from the authoritative domain tables in one call using half-open `Asia/Kolkata` day boundaries.
- Active users are returned even when they have zero work.
- Roles are derived from `user_capabilities` and `capabilities`, not a nonexistent `users.role` column.
- Normal task completions use immutable `task_status_history` events, with a legacy fallback to `tasks.completed_at` when no history exists.
- Spreadsheet-allocated targets completed in My Day are included in “Tasks done”.
- Mapping creation and completion attribution are separated: `requested_by` preserves the requester, while `mapped_by` is set by the user who completes the mapping.
- The obsolete KPI snapshot increment triggers and active snapshot pull/realtime paths are retired without deleting historical snapshot rows.
- The page performs one RPC call per refresh.
- Realtime events only debounce a fresh server aggregation; the browser never increments counters itself.
- The existing CRM component system, page shell, metric cards, table, segmented control, colours, and spacing remain in use.

## Metric definitions

- **Calls:** real `call_logs` rows attributed by `user_id` and `timestamp`; synthetic pipeline arrow logs are excluded.
- **Client queries:** resolved rows attributed by `resolved_by`, with `assigned_to` only as a legacy fallback, grouped by `resolved_at`.
- **Mappings:** completed mapping requests attributed by the actual `mapped_by` completion actor, grouped by `completed_at`.
- **Tasks done:** immutable normal-task completion events plus completed spreadsheet-allocated targets, grouped by their completion timestamps.
- **Total work:** calls + resolved client queries + completed mappings + completed tasks.

## Historical attribution limitation

Historical completed mappings can only use the `mapped_by` value already stored because the old workflow did not preserve a separate requester and completer. Migration 026 backfills `requested_by` from that value for audit continuity. All new mappings correctly preserve both actors.

## Deployment boundary

The repository patch can be statically checked without database access. The live feature will not work until `026_team_kpi_repair.sql` is applied to the same Supabase project used by Vercel, followed by deployment of the matching frontend code.
