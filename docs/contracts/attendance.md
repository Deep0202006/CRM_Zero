# Attendance Contract

## CURRENT

Attendance is user-owned, date-aware, and confirmed through authenticated server APIs. A confirmed attendance business row is Present for its authoritative Asia/Kolkata date regardless of whether selfie evidence is legacy, Storage-backed, expired, purged, or unavailable. Admin Team Attendance is a bounded server-authoritative read; Team KPI uses the same resolver. Field visits may link to a confirmed attendance row; missing/ambiguous attendance is handled explicitly.

## INVARIANT

Ownership is explicit. India business dates use shared IST logic. Evidence availability never determines Present/Absent. Ordinary attendance lists exclude embedded image payloads. Realtime may trigger one deduplicated targeted refresh, never high-frequency polling. Do not fabricate, delete, mass-correct, or silently discard ambiguous records.

## KNOWN DEBT

Legacy attendance compatibility and optional visit linkage require conservative recovery.

Primary tests: `simpleClockoutContract`, `coreReliabilityRelease`, field-visit reliability suites.
