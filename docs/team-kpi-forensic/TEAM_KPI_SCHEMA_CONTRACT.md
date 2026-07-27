# TEAM KPI SCHEMA CONTRACT

## users
- Primary key: id
- Relevant fields: username, full_name, email, role

## tasks
- Primary key: id
- Performer/owner/creator/resolver/completer fields: assigned_to
- Created timestamp: created_at
- Completion timestamp: completed_at
- Status values: 'completed', 'pending'

## call_logs
- Primary key: id
- Performer/owner/creator/resolver/completer fields: user_id
- Created timestamp: created_at

## client_queries
- Primary key: id
- Performer/owner/creator/resolver/completer fields: assigned_to
- Created timestamp: created_at
- Status values: 'resolved', 'pending'

## mapping_requests
- Primary key: id
- Performer/owner/creator/resolver/completer fields: user_id
- Created timestamp: created_at
- Status values: 'completed', 'pending'
