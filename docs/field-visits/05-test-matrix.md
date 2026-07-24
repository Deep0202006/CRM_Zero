# Test Matrix

| Test Case | Description | Expected Outcome |
|---|---|---|
| Clock In | Field user starts day | Selfie captured, attendance logged. |
| Visit Form | User completes a visit | Outcome saved locally to Dexie, synced when online. |
| Offline Mode | User goes offline and logs visit | Saved to Dexie `sync_queue`. |
| Sync Resume | User goes online | `sync_queue` processed, pushed to Supabase. |
