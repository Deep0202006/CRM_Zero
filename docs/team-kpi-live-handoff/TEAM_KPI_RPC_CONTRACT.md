# TEAM KPI RPC CONTRACT
Exact function signature: get_team_kpi_daily(target_date date)
Argument names: target_date
Argument types: date
Return columns: id, email, full_name, role_label, calls, queries, mappings, tasks, total, last_activity_at
Security invoker/definer: SECURITY DEFINER
Search path: pg_catalog, public
Authorization check: current_user_capability('admin_access') or ('manager_access')
Capability names: admin_access, manager_access
Source tables: users, user_capabilities, roles, tasks, allocated_targets, mapping_requests, client_queries, call_logs
User inclusion logic: LEFT JOIN on users
Service-user exclusion logic: is_system_account = false
Date grouping: India timezone (Asia/Kolkata) bounds applied to timestamps
Calls logic: count of call_logs
Client-query logic: count of resolved client_queries
Mapping logic: count of completed mapping_requests
Normal-task logic: count of completed tasks
Spreadsheet-target logic: count of completed allocated_targets
Total logic: sum of all 4 metrics
Last-activity logic: GREATEST of all timestamps
Grants: TO authenticated
Revokes: FROM PUBLIC, FROM anon
Realtime changes: None inside RPC
Snapshot trigger cleanup: Migration 026 removes legacy snapshot triggers.

- Frontend RPC argument names match SQL: Yes
- Frontend response fields match SQL: Yes
- Function may return zero rows because authorization fails: Yes
- Function may return zero rows because user generation fails: No
- Function may fail due to a missing referenced column: No
- Function may fail due to a missing helper function: No
- Function may fail because manual SQL was not applied: Yes
- Function may fail because PostgREST schema cache is stale: Yes
