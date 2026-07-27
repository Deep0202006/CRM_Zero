# KPI Source Contract
## Calls
Remote table: call_logs
Primary key: id
User/performer field: user_id
Occurrence timestamp: created_at
Status/outcome fields: call_status
Synthetic/system marker: NOT IN ('arrow', 'pipeline')
Soft-delete field: UNKNOWN
Offline local table: call_logs
Queue action: sync_queue
Realtime status: ENABLED

## Client queries
Remote table: client_queries
Primary key: id
Creator: user_id
Assigned user: UNKNOWN
Resolver/handler: resolved_by
Resolution timestamp: resolved_at
Status values: resolved
Soft-delete field: UNKNOWN
Offline local table: client_queries
Queue action: sync_queue
Realtime status: ENABLED

## Mappings
Remote table: mapping_requests
Primary key: id
Requester: user_id
Assigned user: allocated_to
Completing user: completed_by
Completion timestamp: completed_at
Status values: completed
Soft-delete field: UNKNOWN
Offline local table: mapping_requests
Queue action: sync_queue
Realtime status: ENABLED

## Tasks (Normal)
Remote table: tasks
Primary key: id
Assigned user: user_id
Completing user: completed_by (implicit via task_status_history or user_id)
Completion timestamp: completed_at
Status values: completed
Reopened behavior: task_status_history tracked
Soft-delete field: UNKNOWN
Offline local table: tasks
Queue action: sync_queue
Realtime status: ENABLED

## Tasks (Spreadsheet targets)
Remote table: allocated_targets
Primary key: target_id
Assigned user: allocated_to
Completing user: completed_by
Completion timestamp: completed_at
Status values: is_completed = true
Reopened behavior: UNKNOWN
Soft-delete field: UNKNOWN
Offline local table: allocated_targets
Queue action: sync_queue
Realtime status: ENABLED
