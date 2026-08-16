# Field Visits Contract

## CURRENT

Visits validate stable UUIDs, IST dates, segment/outcome rules, ownership, human-readable address, location/evidence metadata, and optional attendance linkage. Retailer UI labels the existing address authority as Area; Distributor UI labels it Address. New current-contract visits require a trimmed, bounded text pincode, while historical rows and the previous supported queued payload may retain NULL pincode. Local visit and media are retained transactionally; `/api/field-visits/confirm` confirms the visit and evidence may retry independently. Historic null addresses render neutrally; a queued required-field repair resumes with the same visit ID. Distributor `payment_done` is observational only.

## INVARIANT

Never delete visits or clear visit/media stores. Retry the same visit ID. Evidence cannot block or undo a confirmed visit. Sync is owner-scoped and serializes duplicate attempts. Deterministic 4xx results do not automatically retry; transient failures use bounded backoff. Evidence objects expire five days after successful upload without deleting business rows. List screens never auto-fetch selfie files. Pincode travels in the existing bounded Visit payload and export flow without another request. Field-visit outcomes never mutate financial, Pipeline, or Call authority.

## KNOWN DEBT

Historical reference and optional-schema compatibility paths remain necessary.

Primary tests: `fieldVisitZeroLossContract`, `fieldVisitSyncBehavior`, `fieldVisitStabilization`, `fieldVisitAuthoritativeRepair`.
