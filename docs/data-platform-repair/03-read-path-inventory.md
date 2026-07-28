# Read-path inventory

Authenticated startup runs user-scoped, paginated reconciliation for calls, queries, mappings, tasks, targets, and visits. Cached rows render immediately; confirmed server rows upsert in the background while pending local entity IDs are protected.

Team KPI reads only `get_team_kpi_daily_v5`. Admin Visit Overview reads the authenticated visit report path with server filters, pagination, and filtered totals. Signed evidence URLs are requested only when evidence is opened.

The server must return an error for auth, authorization, missing RPC, malformed response, or database failure. Empty successful data is valid only after a successful server query.
