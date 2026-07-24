# Offline Sync State Machine

- **Current State**: Uses the generic `offline_queue` table which tracks action (INSERT/UPDATE), payload, and retry count.
- **Defects**: Does not have a dedicated UI or state representation for a single visit (e.g., `draft`, `saving_local`, `pending_sync`, `syncing`, `synced`, `failed`, `conflict`).
- **Idempotency**: Handled loosely by `transactionalMutation` using `idempotency_key`, but the generic queue is unaware that a selfie needs uploading to storage first before the row insert.
- **Retry**: Bound to the generic sync worker which may spam the backend with massive Base64 payloads if the network is flaky.
