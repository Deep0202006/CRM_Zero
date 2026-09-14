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

Reader ceilings: 200 active directory records (including excluded identities), 1,000 capability assignments, 100 labels, 1,000 selected-source records per page, at most 21 sequential source pages and 24 reader requests. Empty EOF is charged; at most 20,000 records and 4 MiB decoded source JSON are accepted. A short page alone never establishes exhaustion. One report resource includes the existing authentication call and two admin-authority queries, with at most 27 physical HTTP attempts, no retries and an eight-second deadline. Exact counts establish complete bounded directory/capability reads; a gateway row cap below the directory size makes the cohort unavailable rather than silently smaller. All source pages are discarded on source failure or budget exhaustion. No daily-endpoint loop, analytics persistence, polling or additional chart request is permitted.

Metric meanings:

- **Retained calls:** genuine canonical call records, credited to immutable `user_id`, dated by `timestamp`, deduplicated by `log_id`. The new typed retained-record series shows zero only when the selected source was exhausted; missing source values remain null/gaps. Legacy complete-work fields remain withheld.
- **Retained Visits:** server-confirmed `visit_id`, immutable `user_id`, canonical stored `visit_date`. Check-in timestamps do not move records into another business date. No pending offline work, reached-call or revenue inference.
- **Historical completed tasks / allocated targets:** unavailable. Canonical Today credit uses the current assignee and completion history; mutable assignment and reopen/recompletion prevent reconstructing reliable historical credit. Never substitute the status-event actor.
- **Mapping completion snapshots:** current `Completed` records dated by `completed_at` and attributed only to `mapped_by_id_snapshot`, backed by validated051/054 lifecycle constraints. A nullable live FK is not substituted for the snapshot. Records outside the current reference cohort are out of scope. Reopen removes the current completion; recompletion stamps a new completion. This is not a permanent completion-event ledger, and prior-period comparisons are withheld.
- **Queries:** unavailable; current resolved state is not a complete resolution/reopen event stream.
- **Follow-up subsets / unique completed work:** unavailable historically. Canonical linked call/task deduplication is unchanged; daily unique counts are not summed into multi-day unique work. No reached-call, target-performance, revenue or attendance-range metric is inferred.

No authoritative coverage watermark exists in current source. First activity, purge boundaries and deployment dates must not become one. Every response explicitly reports metric availability, historical coverage, source-read completeness, cohort, scope, generated time, totals, both daily series and full employee register. Legacy complete-work comparisons remain unavailable. The separately typed `retained-record-count-change` compares only exhausted Calls/Visits in equally long closed periods under the same reference scope; it is not complete activity or productivity growth. Prior zero permits absolute change but no percentage. Partial today, missing sources and mutable Mapping snapshots return an explicit comparison-unavailability reason.

The UI uses one selected-metric linear chart with disconnected null gaps, matching exact data table, full employee register and shared detail Sheet. Applied scope remains visible during draft edits, pending requests and failed refreshes. Employee change against their own prior period is first; current-cohort context is descriptive, not a ranking. The selected metric is an explicit request parameter, not a chart-specific request. The client has a12-second cancellation/retry boundary around session lookup and fetch; this does not increase the server deadline.

My Day lazily mounts `self-history-v1` through `/api/my-day/history`. The server derives the sole UUID from the verified active actor and rejects client identity/cohort overrides and Mapping selection. It reuses the pure report builder and minimal source reader, never the Team cohort loader. Agenda, permanent history, pending offline work and confirmed actions retain their existing boundaries.

Primary tests: `teamKpiContract`, `teamKpiApiContract`, `teamKpiLiveAggregation`, `teamKpiWorkflowAttribution`, `teamKpiHistory`, and registered `team-history-e2e`.
