# TEAM KPI FILE INVENTORY

## src/app/manager/kpi/page.tsx
- Purpose: Main Team KPI page component showing team performance metrics.
- Active: Yes
- Modified by recent hotfix: Yes
- Affects metrics: Calls, client queries, mapping requests, tasks.
- Calls: tables `users`, `tasks`, `call_logs`, `client_queries`, `mapping_requests`, `attendance`
- Client-side or server-side: Client-side (in `useEffect`)

## src/app/admin/activity/page.tsx (Activity Deck - Removed)
- Purpose: Admin Day-Wise Activity Engine.
- Active: No (Removed in recent commits)
- Modified by recent hotfix: Removed prior to hotfix
- Affects metrics: Admin visibility of activity
- Calls: N/A

## src/lib/db.ts
- Purpose: Database configuration and utilities
- Active: Yes
- Modified by recent hotfix: No
- Affects metrics: Overall connection
- Calls: Supabase client
- Client-side or server-side: Both
