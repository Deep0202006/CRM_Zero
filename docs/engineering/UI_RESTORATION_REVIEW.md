# Three-page visible analytics restoration

## Scope and baseline

Task `20260914-be1419ee468a`, branch `feat/restore-visible-metriccards-and-primary-ch-97df80db`, managed worktree `.worktrees/restore-visible-metriccards-and-primary-ch-97df80db`.

GitHub PR114 was observed merged at `d88867975bc9c0f63637e73e9799b360ee854547` on 2026-09-14. Main was fetched and verified at that commit. Its three page files match reviewed PR114 head `2172fe48f8a6c528bca1dfb9ba9f292ecbfb5ed8`. Existing worktrees and evidence were preserved.

The Owner’s correction makes `b271ab9d7ab5b172edac607e8e1b5ed572513cd6` the visual reference, superseding PR111’s bar presentation. All five requested historical analytics files were inspected. Only their visual compositions are restored; historical readers, permissions, SQL and action implementations are not copied.

## Source → metric → consumer → proof

| Current authority | Display and population | Page-local consumer | Executable coverage |
| --- | --- | --- | --- |
| My Day’s existing daily-summary ID union, local scoped task/mapping/query/target data | Existing confirmed tasks including targets, local mappings, authorized Calls/follow-ups and queries, confirmed unique work; no mixed total | MetricCards; `MyDaySummaryCharts` independent focus rings and due-date urgency ribbon | `ui-foundation-unit`; My Day consumption and urgency/request cases in `workspace-makeover-e2e` |
| Existing authenticated Today Team report | Same report totals/rows; four independent ring counts; one selected-metric employee partition | MetricCards; `TeamSummaryCharts` work rings, contribution donut and radar | `team-kpi-unit`; contribution/keyboard/request and Sheet cases in both UI browser proofs |
| Same Team cohort and validated integer counts | Each radar axis = raw value / highest employee count for that metric × 100; team average includes selected employee; all-zero axes stay zero | Explicit normalization, raw tooltip/table; withheld peer comparison on warnings/error/stale date | Team browser cases, existing report/coverage regressions |
| Existing applied Visits register and validated full-range report | Global totals exclude date/search; Matching visits uses register total; representative count only when breakdown exhausted; outcome and daily series cover the full range | MetricCards; `VisitSummaryCharts` donut and linear area; exact daily table and outcome filters | 31-date/80-record scope, pager, refresh, failure and request-count case; 14-record report versus 7-record page case |
| Already-loaded Visit records | Retailer/distributor/other composition of this page only, explicitly labeled | Existing `FieldMix`, with its required reconciliation total | Page/range reconciliation, filtered-register and visual browser cases |

No chart adds a request, subscription, polling loop or chart engine. Shared component defaults, authentication, offline confirmation, report request sequencing, selection identity, export handlers, lazy ERP, optional history, Pipeline inspection and Review remain unchanged.

The only registration addition is the exact Visits adapter path in the existing UI proof domain. No SQL, applied ledger, migration, dependency, hook, workflow or infrastructure changes.

## Executed development evidence

Registered typecheck, UI unit (39 tests), build, workspace browser proof and UI Foundation browser proof passed during development. The committed render/proof head was `b0d0c86efc0ba45dbb7bd81c5765ab91d96247cc`. A subsequent cleanup removes only three ineffective Tailwind selectors, verified in compiled CSS to match nonexistent descendants; it does not change the captured presentation.

First causal failures were identified and repaired:

- Typecheck: the reused FieldMix requires an explicit total. The adapter now passes the loaded-page represented total; its guard is preserved.
- UI unit: the Calls today wording assertion required obsolete definition-list markup. It now requires the MetricCard label, while retaining every ID-union and permanent-history assertion.
- Impact planning: the new Visits adapter lacked a mapped path. Its exact UI registration was added without reducing any risk floor or required check.

The one-worker synthetic browser cases demonstrate:

- My Day: one daily-summary request across resize/theme changes; no Team, Pipeline or history consumption. Actual overdue/today/later/missed task counts reconcile, excluding inactive and other-user work. The fixture’s empty confirmed call-ID list remains zero despite an unbacked numeric count in its response.
- Team: one initial KPI request; metric/radar selection adds none. Donut rows partition the selected metric; zero total does not fabricate shares. Existing incomplete-report, refreshed/removed employee and keyboard Sheet behavior remain covered.
- Visits: one initial range-analysis request, one per applied scope, no pager/ordinary-refresh fanout. Explicit analysis refresh adds one. Full-range 80-record daily totals reconcile over 31 dates; page changes do not shrink the range chart. Authorized representative/outcome selection, failed scope retention, export parameters and evidence races remain covered.
- Existing exact-identity offline completion and Pipeline/context action regressions are retained and passed in the workspace proof.

These are local fixture executions, not production observations or CI certificates. Final-head required checks and their actual run are authoritative on the PR; this document does not certify them.

## Actual before/after captures

Before images are preserved PR114 captures, not newly manufactured screenshots. After images were captured from the running application at 1440×900 and 390×900 in both themes. They use bounded synthetic fixtures; dates/freshness differ from the historical before captures. Top, primary-chart and lower-panel captures are separate because mobile panels stack and require natural scrolling—not disclosure or Analysis switching.

| Page | Before | After top | After charts | Lower panels |
| --- | --- | --- | --- | --- |
| My Day, mobile light | [Before](../../artifacts/visual-review/workspace-makeover/pr114-final/my-day-390.png) | [Cards](../../artifacts/visual-review/workspace-makeover/ui-restoration/my-day-390-light-top.png) | [Rings](../../artifacts/visual-review/workspace-makeover/ui-restoration/my-day-390-light-charts.png) | [Urgency and work](../../artifacts/visual-review/workspace-makeover/ui-restoration/my-day-390-light-context.png) |
| Team, mobile dark | [Before](../../artifacts/visual-review/workspace-makeover/pr114-final/team-390-dark.png) | [Cards](../../artifacts/visual-review/workspace-makeover/ui-restoration/team-390-dark-top.png) | [Work rings](../../artifacts/visual-review/workspace-makeover/ui-restoration/team-390-dark-charts.png) | [Radar and raw values](../../artifacts/visual-review/workspace-makeover/ui-restoration/team-390-dark-context.png) |
| Visits, desktop dark | [Before](../../artifacts/visual-review/workspace-makeover/pr114-final/visits-1440-dark.png) | [Cards and filters](../../artifacts/visual-review/workspace-makeover/ui-restoration/visits-1440-dark-top.png) | [Donut and area](../../artifacts/visual-review/workspace-makeover/ui-restoration/visits-1440-dark-charts.png) | [Activity and page-local segments](../../artifacts/visual-review/workspace-makeover/ui-restoration/visits-1440-dark-context.png) |

All 36 after captures are in [the restoration evidence directory](../../artifacts/visual-review/workspace-makeover/ui-restoration).

## Limits and Owner release

Rings contain no unlike-metric center sum, target percentage or performance score. The radar is descriptive, not employee growth or a historical trend. Visits historical capture remains uncertified; today can be partial, and live reads are not atomic. Missing/unavailable reports are not converted to zero. No full-range segment breakdown is invented from a page.

This is presentation restoration only, not delivery of deferred data-capability phases. No Supabase SQL or production activation is needed. Owner reviews the final PR head and all six required GitHub jobs, then uses the protected manual-merge route. Codex must not merge or perform production actions.
