import { buildQueueItem, db, LocalFieldVisit, LocalFieldVisitMedia, processSyncQueue } from "../db";

export class FieldVisitsRepository {
  /**
   * Transactionally saves a new field visit and its associated media to local Dexie.
   * Then triggers the specialized field visits sync process.
   */
  static async saveVisitWithMedia(
    visit: LocalFieldVisit,
    mediaBase64: string | null
  ): Promise<void> {
    await db.transaction('rw', [db.field_visits, db.field_visit_media, db.sync_queue], async () => {
      // 1. Insert local visit
      await db.field_visits.add(visit);

      // 2. If media exists, insert it
      if (mediaBase64) {
        const mediaRecord: LocalFieldVisitMedia = {
          media_id: visit.visit_id,
          visit_id: visit.visit_id,
          user_id: visit.user_id,
          media_data: mediaBase64,
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
