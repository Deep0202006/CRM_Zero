import os

docs_dir = 'docs/team-kpi-final'

files = {
    '00-current-defects.md': '''1. 	ransactionalMutation() acknowledges only local storage, not server success.
2. Queue idempotency keys are random instead of semantic and stable.
3. Queue records are skipped permanently after five retries.
4. Logout clears IndexedDB after a best-effort flush without checking remaining queue records.
5. Task completion and task-history creation are not atomic.
6. Client-query completion, mapping completion and target completion trust browser-supplied actors and timestamps.
7. Existing SQL performs unsafe text operations on enum values.
8. Team KPI directly aggregates evolving operational table shapes.
9. The API still uses v4 and contains a service-role raw-table fallback.
10. The page issues duplicate requests for the same date.
11. Existing remote source counts prove most historical work never reached Supabase.''',

    '01-final-architecture.md': '''- Normalized event projection table: public.team_kpi_events.
- Server-authoritative KPI RPC: public.get_team_kpi_daily_v5.
- Database triggers on source tables (call_logs, client_queries, mapping_requests, task_status_history, tasks, allocated_targets) to automatically capture valid work events safely.
- Server command RPCs (v2) for atomic completion and update workflows.
- A hardened offline sync processor processing semantically stable, deterministic ID queue items.''',

    '02-source-command-contracts.md': '''- **Calls**: log_call_v2 (supports Excel client resolution)
- **Client Queries**: resolve_client_query_v2 (atomically marks resolved)
- **Mappings**: complete_mapping_request_v2 (atomically marks complete)
- **Tasks**: complete_task_v2 (updates status and adds history atomically)
- **Allocated Targets**: complete_allocated_target_v2 (completes target for assigned user)''',

    '03-sync-state-machine.md': '''- Queue uses status (pending, syncing, retry_wait, permanent_failure).
- ailure_kind categories (network, session, permission, validation, schema, constraint, unknown).
- Retry intervals: Immediate, 5s, 15s, 60s, 5m, 15m.
- Items are NOT skipped permanently after five retries.''',

    '04-database-contract.md': '''- Table: public.team_kpi_events
- Contract: event_key (PK), event_type, source_table, source_record_id, performed_by (FK to users), occurred_at, usiness_date, created_at.
- Events captured using schema-qualified, non-browser-executable triggers on source tables.''',

    '05-historical-recovery.md': '''- **Database Backfill**: Migration 030 safely casts ENUMs and backfills events for retained valid work records using timezone conversion (source_timestamp AT TIME ZONE 'Asia/Kolkata')::date.
- **Local Legacy Recovery**: Validates IndexedDB and reconstructs stable deterministic keys for old EXCEL:: or failing sync items into new RPC operations without duplicating work.''',

    '06-test-matrix.md': '''- **Database Contract Tests**: Enum-safety, immutable old migrations, backfill timestamp retention, missing public execute permissions.
- **Sync Tests**: Stable idempotency, sequential merging, no early abandonment, empty pull-down safety, logout prevention.
- **Workflow Tests**: End-to-end workflows representing calls, query resolutions, target completions, mapping updates.
- **KPI Tests**: Zeros included for active users, duplicate event prevention, total arithmetic.''',

    'implementation-state.yaml': '''phase: "audit-complete"
schema_version: "5"
architecture_locked: true'''
}

for name, content in files.items():
    with open(os.path.join(docs_dir, name), 'w', encoding='utf-8') as f:
        f.write(content)
