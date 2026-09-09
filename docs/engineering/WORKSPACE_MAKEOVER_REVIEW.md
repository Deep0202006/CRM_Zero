# Packet A workspace makeover

## Verified starting point

PR112 merged on 2026-09-09 at 05:49:50 UTC. Reviewed head
`dc13c5b7a3366b3e123c056d3af8257addcd9c6c` and fetched merge/main
`ff04cdb46ad06ad0aa1f17211e733e436f234653` have identical source trees.
The separate History worktree and its evidence are preserved. This packet is
task `20260909-dcae0fa440e1`, not a continuation of the completed History task.

## Source → meaning/action → consumer → proof

| Current authority and scope | Meaning / retained action | Packet A composition | Registered evidence |
|---|---|---|---|
| `taskEngine`, authenticated user's active local tasks, canonical follow-up provenance and deduplication | Due date/status views; real lead-linked tasks remain. Existing completion, outcome confirmation, authorized deletion and durable queue identities remain unchanged. | My Day agenda and selected-work context; actual Later records, not a count-only view | `followups-unit`, `workspace-makeover-e2e`, focused consumption regression |
| `my-day/daily-summary`, canonical work metrics and existing authorized report | Typed daily counts; task-only focus signals. No owned-lead/transition or weekly Pipeline consumption. | Secondary factual summary, not a progress/productivity score | `followups-unit`, focused reader regression |
| Existing Admin Visits authorized bounded page | UUID-identified confirmed records; composition partitions only that page. Global totals exclude date/search and remain separately labeled. | Register first, contextual detail, compact outcome strip; ERP stays deliberate/lazy | `field-visits-unit`, `ui-foundation-unit`, `workspace-makeover-e2e` |
| Existing Team KPI Today and PR112 History report | Today typed work; retained historical calls with unknown complete coverage. Gaps and unavailable comparison remain explicit. | Compact counts, employee register, one historical line and employee context | `team-kpi-unit`, `team-history-e2e`, `workspace-makeover-e2e` |
| Pipeline snapshot, exact lead context and owner transition/task services | Same bounded snapshot in board/list. Context is keyed by exact lead UUID, linked work remains authorized and bounded. | Stage navigator, readable cards/list, non-modal wide context and narrow Sheet | `pipeline-unit`, `pipeline-e2e`, delayed-response regression in `workspace-makeover-e2e` |
| Existing Admin inspection response | Segment-wide sampled analytics; owner/source/search/attention filters apply only to inspection list. Current stage age differs from completed-interval duration. | One selected 12-period event series, stage occupancy ribbon, duration/source tables and inspection list | `pipeline-unit`, `workspace-makeover-e2e` |

## Independent criticism resolved before composition

Architecture/data review traced both My Day consumption boundaries, retained
task-only classification and genuine lead-linked tasks, and identified the
local-read/session/fetch/close/unmount race in Pipeline context. Implementation
must guard every asynchronous commit, not only the fetch result. Missing
context must not appear as zero or “no linked task”.

Frontend/performance review requires one active context tree (no duplicate
desktop/mobile IDs), no desktop focus trap, explicit applied scope when prior
records remain visible, and labeled page-local stage/outcome counts. Employee
row selection must not relabel a team-wide historical chart. No chart requests,
new runtime dependencies, polling or visual-only remote reader expansion were added.

Follow-up criticism fixed retained Visits page labeling after failed filters,
kept Missed tasks read-only, and added a 12-second authoritative-context deadline.
Selection generation guards cover local reads, session resolution, response
parsing, close and unmount; abort alone is not treated as a correctness guarantee.
Desktop/narrow context share one tree. History and inspection registers precede
their charts in DOM order as well as visually, preserving keyboard reading order.

Pinned Tremor CategoryBar is used only for a reconciled Visits composition.
Tracker and Sparkline references have no distinct consumer and are not copied.

## Rendered evidence and verification

All captures use local bounded synthetic fixtures, not production/live data.
Before captures used the unchanged merged source. After captures use the actual
implemented routes at 1440/390px, with light/dark coverage for the four workspaces
and additional History register/chart/detail captures. Primary records/actions
are checked in the first viewport, not merely somewhere in a full-page capture.

| Workspace | Before desktop / mobile | After desktop / mobile |
|---|---|---|
| My Day | [Desktop](../../artifacts/visual-review/workspace-makeover/before/my-day-1440.png) / [Mobile](../../artifacts/visual-review/workspace-makeover/before/my-day-390.png) | [Desktop](../../artifacts/visual-review/workspace-makeover/after/my-day-1440.png) / [Mobile](../../artifacts/visual-review/workspace-makeover/after/my-day-390.png) |
| Visits | [Desktop](../../artifacts/visual-review/workspace-makeover/before/visits-1440.png) / [Mobile](../../artifacts/visual-review/workspace-makeover/before/visits-390.png) | [Desktop](../../artifacts/visual-review/workspace-makeover/after/visits-1440.png) / [Mobile](../../artifacts/visual-review/workspace-makeover/after/visits-390.png) |
| Team KPI | [Desktop](../../artifacts/visual-review/workspace-makeover/before/team-1440.png) / [Mobile](../../artifacts/visual-review/workspace-makeover/before/team-390.png) | [Desktop](../../artifacts/visual-review/workspace-makeover/after/team-1440.png) / [Mobile](../../artifacts/visual-review/workspace-makeover/after/team-390.png) |
| Pipeline | [Desktop](../../artifacts/visual-review/workspace-makeover/before/pipeline-1440.png) / [Mobile](../../artifacts/visual-review/workspace-makeover/before/pipeline-390.png) | [Desktop](../../artifacts/visual-review/workspace-makeover/after/pipeline-1440.png) / [Mobile](../../artifacts/visual-review/workspace-makeover/after/pipeline-390.png) |
| Admin inspection | [Desktop](../../artifacts/visual-review/workspace-makeover/before/admin-pipeline-1440.png) / [Mobile](../../artifacts/visual-review/workspace-makeover/before/admin-pipeline-390.png) | [Desktop](../../artifacts/visual-review/workspace-makeover/after/admin-pipeline-1440.png) / [Mobile](../../artifacts/visual-review/workspace-makeover/after/admin-pipeline-390.png) |

Local execution established the real Later loader/identity boundary, task-only
authorized daily summary, exact integer partition checks, delayed Pipeline A/B,
close and timeout handling, applied Visits page retention, empty/partial states,
keyboard Sheet/rail focus behavior and no presentation-specific requests.
Existing Pipeline owner-only actions and one-request/no-poll behavior passed.
Existing INR tooltip precision, ERP deliberate activation/cache/retry and
fractional Pipeline duration/source counts remain covered by registered proofs.

The development-server capture run exposed a pre-login JavaScript SyntaxError;
the built test runtime completed the Packet A checks without that failure.
Use the existing CI-parity build-and-serve path with `NODE_ENV=test` and the
repository's synthetic fixture configuration, not production credentials.
Old assertions for removed presentation were reconciled while retaining their
data invariants. The Team request-count assertion waits for the request rather
than assuming a static register heading means its asynchronous report loaded.

Proof registration reconciliation keeps the production-consistency test's
established platform-handover mapping and R3 floor. An exact-path selector now
selects its existing mandatory handover proof even for a test-only change;
the registered handover check asserts that both it and `auth-unit` are selected.
No runtime, hooks, controller or platform authority changed. The previously
unmapped core-reliability test is also registered with its affected UI proof.

Source review, local execution and captures are not an exact-head CI certificate.
Required proof receipts and GitHub checks for the final PR head govern readiness;
this document does not manufacture either. Owner manual merge only.
The final Ponytail advisory found no unnecessary engine, dependency or abstraction
to remove; existing Tabs/Chart/Sheet and native dates/media/CSS remain the foundation.

## Remaining limitations

Packets B/C remain ordered data-capability backlog. This visual packet does not
certify historical completeness, Visits range intelligence, employee growth,
revenue, target history or Pipeline reader efficiency.
Today counts remain distinct work types; linked work is not blindly summed.
Visit composition and Pipeline board stage counts describe only loaded pages.
History remains retained calls over IST dates with unknown complete coverage,
honest gaps, stable current roster and unavailable unsupported comparisons.
Admin inspection remains the existing bounded sample, not newly certified
complete history. Preview isolation and every Owner-only production gate remain.
