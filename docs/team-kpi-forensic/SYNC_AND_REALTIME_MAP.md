# SYNC AND REALTIME MAP

## call_logs
- Local table name: call_logs
- Remote table name: call_logs
- Primary key: id
- Actor field: user_id
- Occurrence/completion timestamp: created_at / completed_at (if applicable)
- Sync-queue action: Upload on reconnect
- Realtime subscription status: Active
- Duplicate-prevention method: UUIDs generated on client
- Late offline sync preserves original work date: Yes

## client_queries
- Local table name: client_queries
- Remote table name: client_queries
- Primary key: id
- Actor field: assigned_to / user_id
- Occurrence/completion timestamp: created_at / resolved_at
- Sync-queue action: Upload on reconnect
- Realtime subscription status: Active
- Duplicate-prevention method: UUIDs generated on client
- Late offline sync preserves original work date: Yes

## mapping_requests
- Local table name: mapping_requests
- Remote table name: mapping_requests
- Primary key: id
- Actor field: user_id
- Occurrence/completion timestamp: created_at / completed_at
- Sync-queue action: Upload on reconnect
- Realtime subscription status: Active
- Duplicate-prevention method: UUIDs generated on client
- Late offline sync preserves original work date: Yes

## tasks
- Local table name: tasks
- Remote table name: tasks
- Primary key: id
- Actor field: assigned_to
- Occurrence/completion timestamp: created_at / completed_at
- Sync-queue action: Upload on reconnect
- Realtime subscription status: Active
- Duplicate-prevention method: UUIDs generated on client
- Late offline sync preserves original work date: Yes
