# Attendance Contract

## CURRENT

Attendance is user-owned, date-aware, and confirmed through authenticated server APIs. Field visits may link to a confirmed attendance row; missing/ambiguous attendance is handled explicitly.

## INVARIANT

Ownership is explicit. India business dates use shared IST logic. Do not fabricate, delete, or silently choose among ambiguous records.

## KNOWN DEBT

Legacy attendance compatibility and optional visit linkage require conservative recovery.

Primary tests: `simpleClockoutContract`, `coreReliabilityRelease`, field-visit reliability suites.
