# Source-of-truth matrix

| Domain | Confirmed authority | Local cache/outbox | Primary key | Business timestamp |
|---|---|---|---|---|
| Users | `users`, `user_capabilities` | Dexie mirrors | `user_id`, `id` | `created_at` |
| Calls | `call_logs` | `call_logs`, `sync_queue` | `log_id` | `timestamp` |
| Queries | `client_queries` | same names | `query_id` | `resolved_at` |
| Mappings | `mapping_requests`, `mappings` | same names | `request_id`, `mapping_id` | `completed_at`, `completion_timestamp` |
| Tasks | `tasks`, `task_status_history` | same names | `task_id`, `id` | `completed_at`, `changed_at` |
| Targets | `allocated_targets` | same name | `target_id` | `completed_at` |
| Visits | `field_visits`, private Storage | `field_visits`, `field_visit_media`, `sync_queue` | `visit_id` | `check_in_time` |
| KPI | `team_activity_events` | no KPI authority | `event_key` | `occurred_at` |

Dexie never proves cross-device confirmation. Realtime is a refresh signal only.
