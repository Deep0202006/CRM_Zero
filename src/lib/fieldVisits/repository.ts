import { db, LocalFieldVisit, LocalFieldVisitMedia } from "../db";

export class FieldVisitsRepository {
  /**
   * Transactionally saves a new field visit and its associated media to local Dexie.
   * Remote confirmation is deliberately owned by the caller so UI success can
   * never precede the exact server-confirmed visit.
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
  }
}
