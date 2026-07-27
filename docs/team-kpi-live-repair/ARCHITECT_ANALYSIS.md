# Team KPI live-data repair

## Fixed product goal

The existing Team KPI page must retain its current visual structure and show, for every active user and selected India business date:

- calls made;
- client queries resolved;
- mappings completed;
- normal tasks completed;
- spreadsheet targets completed;
- total confirmed work;
- latest confirmed activity time.

## Confirmed weaknesses in the supplied source

1. The page depends directly on `get_team_kpi_daily`. When the function is absent, stale in PostgREST, unauthorized, or incompatible with the live schema, the complete report fails.
2. Runtime handoff documents claim successful live verification but also describe simulated metadata. Those claims are not reliable evidence of production data access.
3. Migrations `014_historical_data_purge.sql` and `015_final_historical_data_purge.sql` delete business records before 8 July 2026. No KPI implementation can reconstruct data that was physically deleted without an external backup.
4. The previous function counts every `Completed` task-history event, so a reopened and recompleted task can be counted multiple times for one day.
5. The application has no server fallback when the RPC is missing or when only one source is temporarily unavailable.
6. Realtime refresh depends on publication configuration. Without a timed visibility-safe fallback, the page can remain stale.
7. Client-side RPC access gives the UI little source-level diagnosis. A single database error can look like an empty report.

## Implemented architecture

### One browser request

The existing page now calls `GET /api/team-kpi?date=YYYY-MM-DD` with the current Supabase access token. It no longer aggregates raw tables or calls the RPC directly in the browser.

### Server authorization

The route verifies the JWT with Supabase and confirms the authenticated user has the exact `admin` capability. It does not trust a browser role flag and does not use a service-role key.

### Server-authoritative paginated aggregation

The server reads the authoritative tables using the administrator's authenticated RLS context and paginates every source beyond Supabase's normal page size:

- `users`
- `user_capabilities`
- `capabilities`
- `call_logs`
- `client_queries`
- `mapping_requests`
- `tasks`
- `task_status_history`
- `allocated_targets`

It includes active users with zero work and never treats a query error as a clean empty dataset.

### Compatibility behavior

- Client queries fall back to `assigned_to` only when legacy schema does not expose `resolved_by`.
- Normal tasks use one completion event per task for the day and fall back to `tasks.completed_at` only when no completion-history event exists.
- Spreadsheet targets are included in Tasks done.
- Synthetic pipeline notes containing the stage arrow are excluded from Calls.
- All timestamp filtering uses half-open Asia/Kolkata day boundaries.
- Source failures produce a visible warning while confirmed metrics from available sources remain displayed.

### Live refresh

The existing realtime subscriptions remain. A single debounced refresh follows relevant source events. A 60-second refresh runs only while the Team KPI tab is visible, ensuring durable updates when realtime publication is unavailable without heavy polling.

### Database authority and safe fallback

Migration `027_team_kpi_live_data_repair.sql` is required for guaranteed complete all-user reporting. The function performs the aggregation under a fixed, admin-authorized database boundary, so ordinary source-table RLS cannot silently hide another employee’s work. It also installs the narrow reporting indexes and idempotent Realtime publication membership needed by this page.

The server-side paginated aggregation remains as a safe degraded fallback before or during a schema-cache problem. It never uses a service-role key, but its completeness is limited by the live source-table RLS policies. Therefore, preview and production approval require migration 027 plus raw-record comparison.

## Deliberately unchanged

- Team KPI page layout, cards, chart, table, typography, colours, spacing and Funnel tab.
- Calls, support, mappings, task completion and offline workflow code.
- Authentication architecture.
- RLS policies and business-table schemas.
- Pipeline, visits, attendance, login and other CRM routes.
