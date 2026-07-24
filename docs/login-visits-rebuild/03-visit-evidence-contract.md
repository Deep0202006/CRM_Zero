# Visit Evidence Contract

## Constraints & Logic

1. **Unified Evidence Section**: Both Selfie and Location must be captured within a single logical block before the user can submit a visit.
2. **Location**:
   - High accuracy required.
   - Timeout of 10s.
   - Must handle permission denied gracefully and guide the user.
3. **Selfie**:
   - Must use the front-facing camera by default.
   - Captured locally as a Blob.
   - Stored in IndexedDB (Dexie) if offline.
   - Uploaded to Supabase storage upon sync; the resulting URL is then attached to the visit record.
4. **Privacy**:
   - Images are not stored as base64 strings in Postgres.
   - Images are uploaded to a secure bucket.
5. **Submission Gate**:
   - The submit button remains disabled until BOTH pieces of evidence are successfully acquired and held in state.
