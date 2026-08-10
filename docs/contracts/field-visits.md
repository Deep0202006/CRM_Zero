# Field Visits Contract

## CURRENT

Visits validate stable UUIDs, IST dates, segment/outcome rules, ownership, location/evidence metadata, and optional attendance linkage. Local visit and media are retained transactionally; `/api/field-visits/confirm` confirms the visit and evidence may retry independently.

## INVARIANT

Never delete visits or clear visit/media stores. Retry the same visit ID. Evidence cannot block or undo a confirmed visit. Sync is owner-scoped and serializes duplicate attempts.

## KNOWN DEBT

Historical reference and optional-schema compatibility paths remain necessary.

Primary tests: `fieldVisitZeroLossContract`, `fieldVisitSyncBehavior`, `fieldVisitStabilization`, `fieldVisitAuthoritativeRepair`.
