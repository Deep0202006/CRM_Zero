# Root Cause Register

| Issue | Root Cause | Proposed Fix |
|---|---|---|
| Focus jumping in Modal.tsx | `onClose` in `useEffect` dependency triggers re-evaluations during parent re-render. | Use `useRef` to store the latest `onClose` callback. |
| Lead-source contract mismatch | Missing enums or string mismatches between frontend schemas and Supabase. | Unify schemas using `zod` in `validation.ts`. |
| KPI sync alias | `sync_queue` assumes local table name matches remote table name. | Introduce a `REMOTE_TO_LOCAL_TABLE` mapping in `sync` logic. |
| Date calculation mismatch | Native `new Date()` used, which uses local system timezone instead of Asia/Kolkata. | Create `dateTime.ts` to enforce Asia/Kolkata everywhere. |
