# Supabase boundary

Execution flow is controlled only by the root `AGENTS.md` and CRM Engineering
Graph. Legacy harness/OS prose must not control phase, blocker or completion.

Local invariant:

Applied owner migrations are immutable. New schema changes use forward migrations. R3 SQL requires disposable PostgreSQL runtime proof. Owner SQL and production mutation are human-gated.

Load the current task context packet and affected domain contract before making
changes. Do not broaden scope.
