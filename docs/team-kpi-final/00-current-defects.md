1. 	ransactionalMutation() acknowledges only local storage, not server success.
2. Queue idempotency keys are random instead of semantic and stable.
3. Queue records are skipped permanently after five retries.
4. Logout clears IndexedDB after a best-effort flush without checking remaining queue records.
5. Task completion and task-history creation are not atomic.
6. Client-query completion, mapping completion and target completion trust browser-supplied actors and timestamps.
7. Existing SQL performs unsafe text operations on enum values.
8. Team KPI directly aggregates evolving operational table shapes.
9. The API still uses v4 and contains a service-role raw-table fallback.
10. The page issues duplicate requests for the same date.
11. Existing remote source counts prove most historical work never reached Supabase.