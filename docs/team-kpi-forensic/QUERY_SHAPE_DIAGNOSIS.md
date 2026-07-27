# QUERY SHAPE DIAGNOSIS

## users
- Table: users
- Selected columns: id, full_name, username, role
- Filters: none explicitly added by frontend
- Date boundaries: none
- Ordering: implicitly by creation or id
- Error code: none (expected success under RLS)
- Whether RLS may limit rows: Yes
- Whether admin scope is explicitly enforced: By RLS

## tasks
- Table: tasks
- Selected columns: assigned_to
- Filters: status.eq('completed')
- Date boundaries: gte(startOfDay), lt(endOfDay)
- Ordering: none
- Error code: none
- Whether RLS may limit rows: Yes

## call_logs
- Table: call_logs
- Selected columns: user_id
- Filters: none
- Date boundaries: gte(startOfDay), lt(endOfDay)
- Ordering: none
- Error code: none
- Whether RLS may limit rows: Yes

## client_queries
- Table: client_queries
- Selected columns: assigned_to
- Filters: status.eq('resolved')
- Date boundaries: gte(startOfDay), lt(endOfDay)
- Ordering: none
- Error code: none
- Whether RLS may limit rows: Yes

## mapping_requests
- Table: mapping_requests
- Selected columns: user_id
- Filters: status.eq('completed')
- Date boundaries: gte(startOfDay), lt(endOfDay)
- Ordering: none
- Error code: none
- Whether RLS may limit rows: Yes
