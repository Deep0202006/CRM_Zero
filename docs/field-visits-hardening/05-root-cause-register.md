# Root Cause Register

| ID | Symptom | Root Cause | File Boundary | Permanent Repair |
|---|---|---|---|---|
| FV-01 | Camera crashes/memory leak on exit | `getUserMedia` tracks are not consistently stopped when unmounting | `src/app/visits/new/page.tsx` | Isolate camera to `SelfieCapture.tsx` with proper `useEffect` cleanup. |
| FV-02 | Cannot submit when offline | `transactionalMutation` might fail if DB is locked, or image is too large | `src/app/visits/new/page.tsx` | Implement dedicated offline queue states for visits; compress image before save. |
| FV-03 | Missing segment filter | Uses `excel_users.json` directly without validating role capabilities | `src/app/visits/new/page.tsx` | Use `db.leads` filtering by `LeadSegment` based on active user capabilities. |
| FV-04 | Visit bypasses attendance checks | Missing server-side attendance verification and India business date check | `supabase/migrations/` | Implement RLS and DB functions to strictly enforce attendance for the exact IST date. |
