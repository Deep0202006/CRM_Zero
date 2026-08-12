# Field Visits Contract

## CURRENT

Visits validate stable UUIDs, IST dates, segment/outcome rules, ownership, human-readable address, location/evidence metadata, and optional attendance linkage. Local visit and media are retained transactionally; `/api/field-visits/confirm` confirms the visit and evidence may retry independently. Historic null addresses render as `Legacy visit — address was not captured`; a pre-address queued operation pauses for address repair and resumes with the same visit ID. Distributor `payment_done` is observational only.

## INVARIANT

Never delete visits or clear visit/media stores. Retry the same visit ID. Evidence cannot block or undo a confirmed visit. Sync is owner-scoped and serializes duplicate attempts. Evidence objects expire five days after successful upload without deleting business rows. List screens never auto-fetch selfie files. Field-visit outcomes never mutate financial, Pipeline, or Call authority.

## KNOWN DEBT

Historical reference and optional-schema compatibility paths remain necessary.

Primary tests: `fieldVisitZeroLossContract`, `fieldVisitSyncBehavior`, `fieldVisitStabilization`, `fieldVisitAuthoritativeRepair`.
