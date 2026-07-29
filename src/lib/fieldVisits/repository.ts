import { buildQueueItem, db, LocalFieldVisit, LocalFieldVisitMedia, processSyncQueue } from "../db";
import { STORAGE_BUDGET } from "../storageBudget";

export class FieldVisitsRepository {
  /**
   * Transactionally saves a new field visit and its associated media to local Dexie.
   * Then triggers the specialized field visits sync process.
   */
  static async saveVisitWithMedia(
    visit: LocalFieldVisit,
    mediaBlob: Blob | null
  ): Promise<void> {
    if (mediaBlob) {
      const pendingMedia = await db.field_visit_media.where("user_id").equals(visit.user_id).toArray();
      const pendingBytes = pendingMedia.reduce((total, item) => total + item.media_data.size, 0);
      if (pendingBytes + mediaBlob.size > STORAGE_BUDGET.pendingMediaLimitBytes) {
        if (typeof navigator !== "undefined" && navigator.onLine) await processSyncQueue();
        const remaining = await db.field_visit_media.where("user_id").equals(visit.user_id).toArray();
        const remainingBytes = remaining.reduce((total, item) => total + item.media_data.size, 0);
        if (remainingBytes + mediaBlob.size > STORAGE_BUDGET.pendingMediaLimitBytes) {
          throw new Error("Pending visit evidence has reached the device storage limit. Reconnect and sync before capturing another selfie.");
        }
      }
    }
    await db.transaction('rw', [db.field_visits, db.field_visit_media, db.sync_queue], async () => {
      // 1. Insert local visit
      await db.field_visits.add(visit);

      // 2. If media exists, insert it
      if (mediaBlob) {
        const mediaRecord: LocalFieldVisitMedia = {
          media_id: visit.visit_id,
          visit_id: visit.visit_id,
          user_id: visit.user_id,
          media_data: mediaBlob,
          created_at: new Date().toISOString()
        };
        await db.field_visit_media.add(mediaRecord);
      }

      const operation = buildQueueItem("field_visits", "INSERT", visit);
      const existing = await db.sync_queue
        .where("idempotency_key")
        .equals(operation.idempotency_key)
        .first();
      if (!existing) await db.sync_queue.add(operation);
    });

    // 3. Trigger dedicated sync asynchronously if online
    if (typeof navigator !== "undefined" && navigator.onLine) {
      processSyncQueue().catch(console.error);
    }
  }
}
