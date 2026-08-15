# Visual Intelligence Contract

## CURRENT

My Day, Team KPI, and Visits Overview render a shared presentation-only visual layer over data those pages already loaded. Recharts is the sole chart engine. Analytics components accept serializable view models through props and contain no Supabase client, fetch, Realtime, polling, Storage, or business mutation path.

My Day shows raw focus counts and mutually labelled task-urgency buckets. Team KPI shows a same-day confirmed-work pulse, employee contribution composition, and a display-only relative KPI profile. The current Team KPI API has one authoritative daily snapshot, so the UI does not fabricate a historical trend. Visits visualizations describe the current bounded page, reconcile every loaded outcome including historical unknowns, and bucket real check-in timestamps with the shared Asia/Kolkata helper. They do not claim a 50-row page is the whole filtered population.

## VISUAL TRUTH

Every visualization declares its source metric, filter scope, timezone, unit, denominator when a share is shown, empty semantics, and error semantics in its panel copy or accessible summary.

- Raw circular comparisons never imply progress toward a target.
- A line or area series requires real historical points; current values are never repeated across invented dates.
- Donut segments reconcile to one explicit represented population.
- Mixed-unit radar dimensions are normalized independently against the same-dimension team maximum. Tooltips retain raw values, and the result is never called a score or rank.
- Card, visualization, and list state update from the same page state. Loading or request failure never becomes a fake zero chart.

## RESOURCE BUDGET

- My Day: zero visualization requests; existing page data flow unchanged.
- Team KPI: one initial `/api/team-kpi` request; existing scoped Realtime signal; no polling.
- Visits Overview: one initial bounded `/api/admin/visits` request; page size 50; evidence remains click-only; no polling.
- Visualization database-query delta: zero.
- Visualization writes, Storage reads, and Realtime channels: zero.

## PROVENANCE

The local compositions use the existing `recharts@3.9.1` dependency and concepts reviewed from shadcn/ui Charts, Tremor Tracker/dashboard composition, and Magic UI NumberTicker/BlurFade. No upstream runtime or verbatim component was added. See `docs/third-party/VISUAL_INTELLIGENCE_PROVENANCE.md`.
