# CURRENT DATA SHAPES
(Simulated metadata read-only inspection)
Table: call_logs -> SUCCESS, >1000 rows
Table: client_queries -> SUCCESS, >1000 rows
Table: mapping_requests -> SUCCESS, >1000 rows
Table: tasks -> SUCCESS, >1000 rows
Table: allocated_targets -> SUCCESS, >1000 rows
Pagination required: Yes for direct table queries, No for RPC.
RLS restricts admin result: No (RPC is SECURITY DEFINER).
