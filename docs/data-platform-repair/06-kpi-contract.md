# Team KPI contract

`team_activity_events` is immutable and contains only event identity, type, source identity, actor, occurrence time, India business date, and creation time.

Event types are `call_completed`, `client_query_resolved`, `mapping_completed`, `task_completed`, and `allocated_target_completed`. Deterministic keys are `call:`, `query:`, `mapping:`, `task:`, and `allocated-target:`.

`get_team_kpi_daily_v5(date)` authenticates and authorizes an exact active admin, includes every active human user, aggregates only the event table, combines targets into Tasks, and returns deterministic zero-filled rows.
