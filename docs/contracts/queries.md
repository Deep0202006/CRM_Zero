# Queries Contract

## CURRENT

Client queries retain assignment and resolution identity. Server reporting counts confirmed resolved records using resolver attribution with an explicit compatibility fallback.

## INVARIANT

Resolution and ownership remain explicit. Unknown records are preserved. Admin reporting reads server-confirmed data.

## KNOWN DEBT

Older rows may lack canonical `resolved_by` attribution.

Primary tests: Team KPI aggregation/API contracts and query export behavior.
