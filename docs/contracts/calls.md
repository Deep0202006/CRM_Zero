# Calls Contract

## CURRENT

Calls use stable `log_id` values, are retained in Dexie while pending, confirmed through `/api/call-logs/confirm`, and read through authoritative history when online. Client references support lead IDs and preserved spreadsheet identities.

## INVARIANT

Never delete call logs. Retry the same ID. Online success requires server confirmation. Explicit `user_id` owns the record. Follow-up/reached/genuine attribution comes from confirmed rows.

## KNOWN DEBT

Offline snapshots are intentionally non-authoritative and legacy client references require parsing compatibility.

Primary tests: `callLogContract`, `coreReliabilityRelease`, `productionConsistencyGuards`.
