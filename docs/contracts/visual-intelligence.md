# Visual Intelligence Contract

## CURRENT

My Day, Team KPI, and Visits Overview render a shared presentation-only visual layer over data those pages already loaded. Recharts is the sole chart engine. Analytics components accept serializable view models through props and contain no Supabase client, fetch, Realtime, polling, Storage, or business mutation path.

My Day is an actionable due-date agenda (Overdue / Today / Later / Done) with exact task identity, existing eligible actions and secondary typed daily counts. It consumes no Pipeline lead signals, export, converted-lead widget or weekly digest. Genuine assigned lead-linked tasks and payment-follow-up identity remain intact.

Team KPI has compact Today counts and a name-default employee register. PR112 History retains observed call records, uncertified coverage, honest gaps and unavailable comparisons; unavailable historical measures live in a Data availability disclosure, not selectable empty charts. One linear historical series and its exact accessible daily table use the same applied report. Employee detail uses a non-modal wide context rail and the existing accessible narrow Sheet. Optional full-cohort descriptive references remain suppressed for incomplete sources or failed refresh.

Operational Pipeline board/list use the same bounded snapshot and owner actions. Selected context is exact-UUID guarded across asynchronous reads, changes of selection, close, unmount and account changes, with a bounded retryable timeout. Admin Pipeline uses canonical stage occupancy, one selected 12-period event line, separate current-stage age and completed-interval P50/mean/sample tables, and reconciled source conversion. Segment-wide analytics and list-only filters are labeled separately.

Visits puts the confirmed register first. The compact outcome strip partitions only the successful applied page, including explicit historical unknowns. Failed draft filters cannot relabel retained records. Selected detail retains its original record snapshot and scope. ERP composition still adapts from donut to bars above six categories and preserves unique-business reconciliation; field ERP coverage uses paired 0–100 bars. Calls, Distributor milestones and Renewals remain separate unchanged consumers.

## VISUAL TRUTH

Every visualization declares its source metric, filter scope, timezone, unit, denominator when a share is shown, empty semantics, and error semantics in its panel copy or accessible summary.

- Raw circular mixed-count comparisons are not used as primary decision visuals.
- A line or area series requires real historical points; current values are never repeated across invented dates.
- Donut segments reconcile to one explicit represented population.
- Employee/team comparisons use the same unit for both series and are never called a score, productivity rank, or grade.
- Card, visualization, and list state update from the same page state. Loading or request failure never becomes a fake zero chart.

## RESOURCE BUDGET

- My Day: zero visualization requests; unnecessary owned-lead, transition, converted-lead and weekly-digest consumption removed. Existing task generation/deduplication/recovery and real Later task reads are reused.
- Team KPI: one initial `/api/team-kpi` request; existing scoped Realtime signal; no polling.
- Visits Overview: one initial bounded `/api/admin/visits` request; page size 50; evidence remains click-only; no polling.
- Manager Pipeline: one bounded `/api/pipeline/inspection` request per explicit server-filter change; page size 50; no polling or chart-owned request.
- Calls, Distributor Status, Renewals, and Field ERP: zero visualization requests; their existing metrics/read paths are unchanged.
- Visualization database-query delta: zero. Removing unnecessary My Day consumption does not expand server readers.
- Visualization writes, Storage reads, and Realtime channels: zero.

## PROVENANCE

The local compositions use the existing `recharts@3.9.1` dependency and concepts reviewed from shadcn/ui Charts, Tremor Tracker/dashboard composition, and Magic UI NumberTicker/BlurFade. UI Foundation V3 vendors the pinned official shadcn Tabs, Chart and Sheet sources and Card composition with exact Radix/CVA/clsx/tailwind-merge dependencies. ChartContainer is the sole responsive owner; the value-only formatting adapter preserves unavailable versus zero and existing financial precision. Controlled manual Tabs defer Pipeline/ERP activation; the ERP page owns its cache and explicit error retry. See `docs/third-party/VISUAL_INTELLIGENCE_PROVENANCE.md`.
