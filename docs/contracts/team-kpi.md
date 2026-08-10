# Team KPI Contract

## CURRENT

Team KPI is loaded by an authenticated admin server route, aggregates confirmed server sources within IST day bounds, validates response shape/totals, and applies explicit user attribution. Compatible missing optional sources become warnings; required user authority fails closed.

## INVARIANT

Admin reporting is server-authoritative. Target date, unique users, totals, attribution, and authorization are validated. Browser totals are not authority.

## KNOWN DEBT

Historical schema variants remain as explicit compatibility readers.

Primary tests: `teamKpiContract`, `teamKpiApiContract`, `teamKpiLiveAggregation`, `teamKpiWorkflowAttribution`.
