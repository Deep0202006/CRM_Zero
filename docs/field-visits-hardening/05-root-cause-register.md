# Root Cause Register

| ID | Symptom | Root Cause | File Boundary | Permanent Repair |
|---|---|---|---|---|
| FV-01 | Camera crashes/memory leak | `videoRef.current` may be null before render, and object URLs aren't revoked. | `SelfieCapture.tsx` | Attach stream in an effect after mount, stop tracks on cleanup, and explicitly revoke object URLs. |
| FV-02 | Sync queue bloat | The `Blob` selfie is duplicated in local visit and generic sync queue. | `SelfieCapture.tsx`, `sync.ts` | Store media in dedicated `field_visit_media` and sync with lightweight metadata. Use Web Worker compression to enforce ~200KB. |
| FV-03 | Location failures | Automatic fetch on mount drops early failures; `!lat \|\| !lng` rejects valid `0` coords. | `visits/new/page.tsx` | Fetch via button click, explicitly check `lat !== null`. Capture accuracy/quality metadata. |
| FV-04 | Admin view lag | Signed URLs are fetched repeatedly during list rendering, and data is all Dexie-based. | `admin/visits/page.tsx` | Build a server-authoritative admin API endpoint. Fetch evidence URLs on demand via a dedicated endpoint. |
| FV-05 | Export missing | CSV button is a placeholder. No Excel logic exists. | `admin/visits/page.tsx`, `api/admin/visits/export` | Build an API route utilizing `xlsx` to generate the 4 required sheets server-side. |
| FV-06 | Bad Outcome data | Hardcoded legacy string values are used instead of database constraints. | `visits/new/page.tsx`, schema | Enforce canonical `FIELD_VISIT_OUTCOMES` on the client and DB for v2 rows. |
| FV-07 | Offline visits blocked | DB function `is_valid_ist_date` blocks delayed syncs after midnight. | `021_field_visits_hardening.sql` | Allow syncs matching `visit_date == attendance.date` rather than current server date. |
| FV-08 | Public URL error | A public URL is generated for the private `visits-evidence` bucket. | `db.ts` / sync | Use deterministic private paths uploaded securely and fetch signed URLs explicitly. |
