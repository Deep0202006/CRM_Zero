# Attendance Contract

## CURRENT

Attendance is user-owned, date-aware, and confirmed through authenticated server APIs. A confirmed attendance business row is Present for its authoritative Asia/Kolkata date regardless of whether selfie evidence is legacy, Storage-backed, expired, purged, or unavailable. Admin Team Attendance is a bounded server-authoritative read; Team KPI uses the same resolver. Field visits may link to a confirmed attendance row; missing/ambiguous attendance is handled explicitly.

Incident contract: the user-observed failure was a selfie clock-in that did not appear in Team Attendance. The authoritative expected result is one confirmed `public.attendance` row that resolves Present for the same `public.users.user_id` in employee Attendance, Admin Attendance, and Team KPI. A late-sync maximum is not part of this incident.

```text
WRITE
src/app/attendance/page.tsx::handleClockIn
  -> src/lib/attendance/location.ts::captureAttendanceLocation (field)
  -> src/lib/db.ts::saveAttendanceWithEvidence
  -> IndexedDB attendance + sync_queue (stable attendance ID, queue schema version, Blob)
  -> src/lib/db.ts::confirmQueuedAttendance / processSyncQueueInternal
  -> src/lib/syncPayload.ts::prepareSyncPayload
  -> src/app/api/attendance/confirm/route.ts::POST
  -> auth.users.id == public.users.user_id == attendance.user_id
  -> private visits-evidence/attendance/{user_id}/{date}/{attendance_id}.jpg (field)
  -> public.attendance UNIQUE(user_id,date)
  -> canonical response -> queue ACK

READ
public.attendance
  -> src/app/api/attendance/mine/route.ts -> employee Attendance / CheckInGate
  -> src/app/api/admin/attendance/route.ts -> src/lib/attendance/authority.ts::resolveAttendanceDay -> Team Attendance
  -> src/lib/teamKpi/serverReport.ts -> src/lib/teamKpi/aggregate.ts::buildTeamKpiReport
     -> src/lib/attendance/authority.ts::resolveAttendanceDay -> Team KPI
```

Attendance eligibility is derived from capabilities through `attendanceModeForCapabilities`, never names or role labels:

| Mode | Write | Read | Evidence |
|---|---|---|---|
| `field_selfie` (`field_dist` or `field_ret`, non-Admin) | Own Attendance on its original IST capture date | Own authoritative state; Admin reads all eligible staff | Selfie and location required for current queue schema |
| `office_auto` (onboarding/support, non-field, non-Admin) | Own Attendance on its original IST capture date | Own authoritative state; Admin reads all eligible staff | No selfie/location required |
| `admin_read_only` | No personal Attendance | Admin Attendance and Team KPI | Not applicable |
| `not_eligible` | No Attendance | No employee Attendance | Not applicable |

Office auto-attendance is created only after `/api/attendance/mine` returns the server-authoritative `office_auto` mode. While online, the Attendance screen also uses that response's mode to select the field-evidence or office flow. Cached capabilities remain the offline fallback, but they cannot downgrade a server field role into evidence-free office Attendance.

## INVARIANT

Ownership is explicit. India business dates use shared IST logic: the submitted date must equal the IST date derived from the immutable `clock_in` capture timestamp. Synchronization time does not replace capture time, and no maximum replay window exists unless separately approved. Evidence availability never determines Present/Absent. A local row with an active/review queue item is not confirmed authority. `review_required`, `quarantined`, and other passive recovery evidence is never selected by an automatic queue pass; direct confirmation and background drains share one origin-wide lock. A successful write is certified only after employee, Admin Attendance, and Team KPI resolve the same server row. Ordinary attendance lists exclude embedded image payloads. Realtime may trigger one deduplicated targeted refresh, never high-frequency polling. Do not fabricate, delete, mass-correct, or silently discard ambiguous records.

## LIVE CERTIFICATION

Production SHA `51613cdcdeeb9845f74e808304107d364efdce62` received five natural successful confirmations on 2026-08-15: four unique authoritative rows across `field_selfie` and `office_auto`, plus one idempotent replay. Every unique row converged in the employee reader, Admin Team Attendance, and Team KPI with no duplicate and no dummy production data.

## KNOWN DEBT

Legacy attendance compatibility and optional visit linkage require conservative recovery.

Primary tests: `attendanceWriteReadClosure`, `attendanceEvidenceLifecycle`, `attendanceAuthority`, `simpleClockoutContract`, and Attendance/field-visit E2E suites.
