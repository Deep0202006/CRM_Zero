# Test matrix

| Layer | Coverage |
|---|---|
| Unit | India boundaries, stable keys, dedupe, classification, backoff, KPI arithmetic, visit validation, merge protection |
| Migration static | commands, grants, RLS, enum-safe casts, immutable projection, triggers, backfill, reconciliation |
| Offline | local-first save, restart, reconnect, one server row/event, retained failures, logout refusal |
| Cross-device | two contexts, server confirmation, bootstrap on B, admin KPI/visits refresh |
| Regression | login, pipeline, attendance, My Day, support, mapping, tasks, navigation, screenshots |

Database and browser tests requiring configured Supabase test services must report skipped/not-run honestly; they are not treated as passed.
