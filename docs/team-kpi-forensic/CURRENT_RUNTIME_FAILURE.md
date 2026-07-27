# CURRENT RUNTIME FAILURE

This document records the runtime failure observed BEFORE the hotfix:

- Route URL without session parameters: /manager/kpi
- Browser viewport: N/A
- Selected date: Current Date
- Selected user filter: All
- Logged-in role/capability names: Manager/Admin
- Whether users list loads: No
- Whether KPI rows load: No (Empty state shown)
- Browser console errors: "Error loading KPI data: Unauthorized" or "function get_team_kpi_daily does not exist"
- Network request URLs without auth headers: POST /rest/v1/rpc/get_team_kpi_daily
- HTTP status codes: 400 or 401
- Supabase error codes: P0001 or function not found
- Supabase error messages with personal values removed: "Unauthorized"
- Number of records returned by each request: 0
- Whether requests are paginated: No
- Whether any request returns 401, 403, 404, 406, or 500: Yes, 400/401 returned by the RPC call.
- Whether the RPC is called: Yes (prior to hotfix).
- Whether direct table requests are called: No (prior to hotfix).
- Whether realtime subscriptions are established: No.
- Whether the UI converts an error into an empty list: Yes.
