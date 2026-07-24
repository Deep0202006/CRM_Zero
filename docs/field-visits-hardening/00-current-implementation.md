# Current Implementation Audit

- Location: `src/app/visits/page.tsx` and `src/app/visits/new/page.tsx`.
- The New Visit page currently handles everything inline (camera, geolocation, form state).
- Role logic: Checks against `excel_users.json` instead of proper lead restrictions per role (`field_ret` vs `field_dist`).
- Outcomes: Hardcoded array ("Successful Pitch", etc.) instead of the DB ENUMs ("registered", "installed", etc.).
- Selfie logic: Inline `navigator.mediaDevices.getUserMedia`. Not decoupled. Doesn't correctly stop tracks on unmount.
- Storage: Stores uncompressed base64 locally and likely uploads it raw (or hasn't implemented upload properly yet).
- Sync: Uses `transactionalMutation("field_visits", "INSERT", ...)`, which dumps it into the offline queue without a clear state machine for "syncing", "synced", "failed".
