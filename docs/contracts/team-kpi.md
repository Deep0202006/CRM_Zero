# Team KPI Contract

## CURRENT

Team KPI is loaded by an authenticated admin server route, aggregates confirmed server sources within IST day bounds, validates response shape/totals, and applies explicit user attribution. Its canonical participant set contains unique active internal team members: `erp_partner_viewer` identities and the reserved normalized `ZeroDataAdmin` technical profile are excluded, while real employee administrators remain included. Compatible missing optional sources become warnings; required user authority fails closed.

## INVARIANT

Admin reporting is server-authoritative. Participant classification happens before metrics, attendance, totals, member count, and charts are derived. Target date, unique users, totals, attribution, and authorization are validated. Browser totals are not authority.

## KNOWN DEBT

Historical schema variants remain as explicit compatibility readers.

Primary tests: `teamKpiContract`, `teamKpiApiContract`, `teamKpiLiveAggregation`, `teamKpiWorkflowAttribution`.
