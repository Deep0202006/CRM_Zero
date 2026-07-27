# Team KPI CTO Root-Cause Analysis

## Why earlier repairs could still show no data

The existing Team KPI page was repeatedly changed without a trustworthy live-database diagnosis. The supplied repository itself contains contradictory forensic documents: one document says the production page is populated, while another explicitly says its data-shape inspection was simulated. Other documents describe user and capability column names that do not match the current source schema.

The current application therefore has no reliable proof that all of the following are simultaneously true in the live Supabase project:

- the expected RPC is installed;
- PostgREST has the current function signature;
- the function references only columns that exist live;
- the logged-in account has the exact `admin` capability;
- source-table RLS permits fallback reads;
- all completion workflows persist stable actor and timestamp fields;
- historical rows are still retained.

Migration 027 improved aggregation but still aggregated operational tables at report time. Its server fallback could also return incomplete or empty data under source-table RLS. That made a database installation failure appear similar to a genuine zero-work day.

## Final architecture

Migration 028 introduces one additive, idempotent `team_work_events` ledger.

Each confirmed domain action creates one stable ledger event:

- real call log;
- resolved client query;
- completed mapping;
- task completion transition or legacy completed task;
- completed spreadsheet target.

The ledger is populated in two ways:

1. **Historical backfill** from every retained source record.
2. **Narrow database triggers** for future inserts, updates, reopens, reassignment corrections, and deletes.

Every event has a deterministic unique key, responsible user, occurrence timestamp, and India business date. Retries update the same event instead of adding another event.

The Team KPI report then performs one stable query over the ledger and left joins all active users. Users with no work remain visible with zero values.

## Runtime failure behavior

The API now requires `get_team_kpi_daily_v3`. It does not silently fall back to raw RLS-limited operational-table aggregation. Missing migration, database errors, obsolete source responses, date mismatches, and missing active users produce distinct diagnostic error codes instead of an empty table.

A separate admin-only health RPC returns only non-sensitive counts. This makes future diagnosis possible without reading customer records or exposing service-role credentials.

## Performance

The page subscribes only to:

- `team_work_events`;
- `users`;
- `user_capabilities`.

It no longer subscribes to every calls, query, mapping, task, history, and target table. Realtime events only trigger one debounced report refresh. The existing one-minute visible-tab refresh remains a lightweight fallback.

## Change boundary

The implementation does not alter the visual Team KPI composition, Funnel tab, login, pipeline, visits, attendance, calls, support, mappings, tasks, My Day, global CSS, or design tokens.
