# Current Sync Flow

- **Local Storage**: The `field_visits` table is registered in Dexie `db.ts` with a `sync_status` index.
- **Queueing**: A generic `transactionalMutation` is used to log the INSERT action into `offline_queue`.
- **Processing**: The sync worker iterates over the generic queue. When processing `field_visits`, it executes an RPC or standard insert.
- **Defects**:
  1. The generic queue expects the row payload to exactly match the DB schema. However, for visits, the local row contains raw image data that needs to be uploaded to a bucket first.
  2. A failure in image upload should halt the row insertion, but the generic queue lacks this decoupled orchestration.
  3. `db.ts` has hooks for `field_visits` sync success/failure but they are entangled with the generic sync worker.
