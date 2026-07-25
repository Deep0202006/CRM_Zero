# Test Matrix

## Pre-Requisites
- India Business Date rules strictly enforced (IST).
- User has active Attendance for the matching day.

## Offline First
- [ ] Submitting a visit offline saves to Dexie `field_visits` with state `pending_sync`.
- [ ] Sync worker detects online state and transitions `pending_sync` -> `syncing`.
- [ ] Image is uploaded to `visits-evidence` bucket, returning a path.
- [ ] Database row is inserted with the image path.
- [ ] State transitions to `synced` and UI reflects this cleanly.

## Edge Cases
- [ ] Network drops during image upload -> row remains `pending_sync` or `sync_failed`.
- [ ] Image uploads but row insert fails -> retry should not re-upload image if path is already saved locally.
- [ ] Massive image payload (10MB+) -> UI gracefully handles compression to <200kb before local save.

## Admin Export
- [ ] Hitting `/api/admin/visits/export` as admin downloads a valid `xlsx` file.
- [ ] File contains exactly 4 sheets: Summary, Visit Register, Representative Summary, Data Dictionary.
- [ ] Non-admin gets 403 Forbidden.
