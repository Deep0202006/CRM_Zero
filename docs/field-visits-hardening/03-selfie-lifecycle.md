# Selfie Lifecycle Audit

- **Capture**: The browser's `navigator.mediaDevices.getUserMedia` is used directly in `NewVisitPage` without proper cleanup (memory leaks possible if unmounted abruptly).
- **Compression**: Currently, no compression is applied. The full canvas is converted to a JPEG Data URL (base64) which is highly inefficient for IndexedDB and Postgres.
- **Persistence**: Base64 is stored in Dexie and pushed to the sync queue.
- **Upload**: The sync queue attempts to write the entire Base64 payload. There is no decoupled storage upload for evidence before row insertion. 
- **Privacy**: No strict privacy/scrambling before upload. Raw Base64 could expose data if the offline queue is dumped.
