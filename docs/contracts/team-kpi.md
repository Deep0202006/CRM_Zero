# Team KPI Contract

## CURRENT

Team KPI is loaded by an authenticated admin server route, aggregates confirmed server sources within IST day bounds, validates response shape/totals, and applies explicit user attribution. Its canonical participant set contains unique active internal team members: `erp_partner_viewer` identities and the reserved normalized `ZeroDataAdmin` technical profile are excluded, while real employee administrators remain included. Compatible missing optional sources become warnings; required user authority fails closed.

## INVARIANT

Admin reporting is server-authoritative. Participant classification happens before metrics, attendance, totals, member count, and charts are derived. Target date, unique users, totals, attribution, and authorization are validated. Browser totals are not authority.

## KNOWN DEBT

Historical schema variants remain as explicit compatibility readers.

## Team and Employee History V1

The no-parameter route retains Today semantics. `from` and `to` select inclusive IST business dates, at most 31 days, ending no later than today. Optional `employee` must be a UUID in the authorized current cohort. Duplicate filters, incomplete ranges and invalid dates fail server-side. The supported four-digit calendar starts at 1000-02-01 to leave room for the adjacent period; this is not a data-coverage floor.

History uses the same active internal participant helper as Today. The full current roster is fixed across the selected and adjacent equally long previous period. Selecting an employee narrows selected totals/series, not the reference register/cohort. This is current-roster history, not reconstructed historical employment or role membership.

One combined read covers at most 62 business days using half-open UTC timestamp bounds derived from IST. The current end is capped at generation time. Authorization remains the existing authenticated active-admin gate; Preview isolation remains enforced by the existing backend factory.

Reader ceilings: 200 active directory records (including excluded identities), 1,000 capability assignments, 100 labels, 1,000 call records per page, at most 20 sequential call pages and 24 reader requests. A full twentieth page is uncertified/truncated, not silently accepted. Thus a completed read returns at most 19,999 records. The existing authentication call and two admin-authority queries are additional to this reader budget. Exact counts establish complete bounded directory/capability reads; any failure or cap violation fails closed. All call pages are discarded on source failure or exhaustion. No daily-endpoint loop, analytics persistence, polling or additional chart request is permitted.

Metric meanings:

- **Observed retained calls:** genuine canonical call records, credited to immutable `user_id`, dated by `timestamp`, deduplicated by `log_id`. The response provides exact retrieved counts; these are not all-work totals. Empty chart buckets are null/gaps even when the retained-record count is zero.
- **Historical completed tasks / allocated targets:** unavailable. Canonical Today credit uses the current assignee and completion history; mutable assignment and reopen/recompletion prevent reconstructing reliable historical credit. Never substitute the status-event actor.
- **Mappings:** unavailable where legacy `updated_at` does not establish completion time and historical attribution.
- **Queries:** unavailable; current resolved state is not a complete resolution/reopen event stream.
- **Follow-up subsets / unique completed work:** unavailable historically. Canonical linked call/task deduplication is unchanged; daily unique counts are not summed into multi-day unique work. No reached-call, Visits, target-performance, revenue or attendance-range metric is inferred.

No authoritative coverage watermark exists in current source. First activity, purge boundaries and deployment dates must not become one. Every response explicitly reports metric availability, historical coverage, source-read completeness, cohort, scope, generated time, totals, both daily series and full employee register. Complete historical work and comparisons are withheld. Partial today is not comparable with a complete prior day without equivalent elapsed coverage. Prior zero never yields a fabricated percentage; although absolute change could be valid for certified equivalent periods, this reader cannot certify them and returns both changes null with a reason.

The UI uses one selected-metric linear chart with disconnected null gaps, matching exact data table, full employee register and shared detail Sheet. Applied scope remains visible during draft edits, pending requests and failed refreshes. Employee change against their own prior period is first, explicitly unavailable; current-cohort context is descriptive, not a ranking.

Primary tests: `teamKpiContract`, `teamKpiApiContract`, `teamKpiLiveAggregation`, `teamKpiWorkflowAttribution`, `teamKpiHistory`, and registered `team-history-e2e`.
