- Queue uses status (pending, syncing, retry_wait, permanent_failure).
- ailure_kind categories (network, session, permission, validation, schema, constraint, unknown).
- Retry intervals: Immediate, 5s, 15s, 60s, 5m, 15m.
- Items are NOT skipped permanently after five retries.