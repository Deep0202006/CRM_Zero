import { db, LocalFieldVisit, LocalFieldVisitMedia } from "../db";
import { syncFieldVisits } from "./sync";

export class FieldVisitsRepository {
  /**
   * Transactionally saves a new field visit and its associated media to local Dexie.
   * Then triggers the specialized field visits sync process.
   */
  static async saveVisitWithMedia(
    visit: LocalFieldVisit,
    media: Blob | string | null
  ): Promise<void> {
    await db.transaction('rw', [db.field_visits, db.field_visit_media], async () => {
      // 1. Insert local visit
      await db.field_visits.add(visit);

      // 2. If media exists, insert it
      if (media) {
        const mediaRecord: LocalFieldVisitMedia = {
          media_id: crypto.randomUUID(),
          visit_id: visit.visit_id,
          user_id: visit.user_id,
          media_data: media,
          created_at: new Date().toISOString()
        };
        await db.field_visit_media.add(mediaRecord);
      }
    });

    // 3. Trigger dedicated sync asynchronously if online
    if (typeof navigator !== "undefined" && navigator.onLine) {
      syncFieldVisits().catch(console.error);
    }
  }
}
