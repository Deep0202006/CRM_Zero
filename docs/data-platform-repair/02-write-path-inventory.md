# Write-path inventory

| Workflow | UI | Local write | Stable operation | Server command | Confirmation |
|---|---|---|---|---|---|
| Call | `app/call-logs`, `app/my-day` | call + outbox transaction | `call:<log_id>` | `log_call_v3` | returned call row |
| Query resolution | `app/support` | query + outbox | `query-resolution:<query_id>` | `resolve_client_query_v3` | returned query row |
| Mapping completion | `app/mappings` | request + outbox | `mapping-completion:<request_id>` | `complete_mapping_v3` | returned request row |
| Task completion | `taskEngine` / My Day | task + outbox | `task-completion:<task_id>` | `complete_task_v3` | task and history transaction |
| Target completion | My Day | target + outbox | `allocated-target-completion:<target_id>` | `complete_allocated_target_v3` | returned target row |
| Visit | visit forms/repository | visit, media, outbox transaction | `field-visit:<visit_id>` | `create_field_visit_v3` | returned visit row |

Legacy generic commands remain only for non-completion CRUD. Zero-row updates are failures. Duplicate operations reconcile by operation ID.
