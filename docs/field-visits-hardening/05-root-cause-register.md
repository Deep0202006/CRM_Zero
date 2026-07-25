# Root Cause Register

| ID | Symptom | Root Cause | File Boundary | Permanent Repair |
|---|---|---|---|---|
| FV-01 | Offline queue bloated, network timeouts | Images are uncompressed and sent via generic JSON payload. | `SelfieCapture.tsx`, `sync.ts` | Compress image client-side to <200kb. Decouple storage upload from row insert in sync worker. |
| FV-02 | Incomplete Admin Export | Current export is a placeholder CSV button without data. | `admin/visits/page.tsx`, `api/admin/visits/export` | Build an API route utilizing `xlsx` to generate the 4 required sheets server-side. |
| FV-03 | Attendance bypass | Client is not explicitly required to provide `attendance_id` mapping to a valid check-in. | `visits/new/page.tsx`, `db.ts` | Fetch active attendance ID via `CheckInGate` state and attach it to the local visit row. |
| FV-04 | RLS lacks segment validation | `field_visits` insert RLS allows user to insert any `segment_type`. | `021_field_visits_hardening.sql` | Extend RLS to verify `user_capabilities` against the provided `segment_type`. |
