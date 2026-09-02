# Visual Intelligence Contract

## CURRENT

My Day, Team KPI, and Visits Overview render a shared presentation-only visual layer over data those pages already loaded. Recharts is the sole chart engine. Analytics components accept serializable view models through props and contain no Supabase client, fetch, Realtime, polling, Storage, or business mutation path.

My Day shows independent work signals and mutually labelled task-urgency buckets; unlike work types are never summed. Team KPI shows horizontal work-by-type bars, employee contribution by a selected exact metric, and a grouped same-unit employee/team comparison. Pipeline uses ordered horizontal stage counts and current-stage-age bars; its charts consume the server inspection projection. Visits visualizations describe the current bounded page, reconcile every loaded outcome including historical unknowns, and bucket real check-in timestamps with the shared Asia/Kolkata helper. ERP composition adapts from donut to bars above six categories while preserving its unique-business reconciliation.

## VISUAL TRUTH

Every visualization declares its source metric, filter scope, timezone, unit, denominator when a share is shown, empty semantics, and error semantics in its panel copy or accessible summary.

- Raw circular mixed-count comparisons are not used as primary decision visuals.
- A line or area series requires real historical points; current values are never repeated across invented dates.
- Donut segments reconcile to one explicit represented population.
- Employee/team comparisons use the same unit for both series and are never called a score, productivity rank, or grade.
- Card, visualization, and list state update from the same page state. Loading or request failure never becomes a fake zero chart.

## RESOURCE BUDGET

- My Day: zero visualization requests; existing page data flow unchanged.
- Team KPI: one initial `/api/team-kpi` request; existing scoped Realtime signal; no polling.
- Visits Overview: one initial bounded `/api/admin/visits` request; page size 50; evidence remains click-only; no polling.
- Manager Pipeline: one bounded `/api/pipeline/inspection` request per explicit server-filter change; page size 50; no polling or chart-owned request.
- Visualization database-query delta: zero.
- Visualization writes, Storage reads, and Realtime channels: zero.

## PROVENANCE

The local compositions use the existing `recharts@3.9.1` dependency and concepts reviewed from shadcn/ui Charts, Tremor Tracker/dashboard composition, and Magic UI NumberTicker/BlurFade. No upstream runtime or verbatim component was added. See `docs/third-party/VISUAL_INTELLIGENCE_PROVENANCE.md`.
