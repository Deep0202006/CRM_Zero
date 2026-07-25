import { db } from "../db";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

/**
 * Synchronizes pending field visits and their media from Dexie to Supabase.
 * Bypasses the generic sync_queue to handle media uploads securely.
 */
export async function syncFieldVisits() {
  if (!navigator.onLine || !isSupabaseConfigured) return;

  const pendingVisits = await db.field_visits
    .where('sync_status')
    .equals('pending_sync')
    .toArray();

  if (pendingVisits.length === 0) return;

  for (const visit of pendingVisits) {
    try {
      // 1. Check if there's associated media in Dexie
      const mediaRecords = await db.field_visit_media
        .where({ visit_id: visit.visit_id })
        .toArray();

      const mediaRecord = mediaRecords.length > 0 ? mediaRecords[0] : null;

      // 2. If media exists, upload to Supabase Storage
      if (mediaRecord && mediaRecord.media_data) {
        // We convert base64 to Blob
        const fetchResponse = await fetch(mediaRecord.media_data);
        const blob = await fetchResponse.blob();
        
        const file = new File([blob], 'selfie.jpg', { type: 'image/jpeg' });
        const filePath = `${visit.user_id}/${visit.visit_date}/${visit.visit_id}.jpg`;
        
        const { error: uploadError } = await supabase.storage
          .from('visits-evidence')
          .upload(filePath, file, { upsert: true });
          
        if (uploadError) {
          throw new Error(`Media upload failed: ${uploadError.message}`);
        }

        // We only store the relative path securely, NOT the public URL
        visit.selfie_storage_path = filePath;
      }

      // 3. Insert visit into Supabase using an idempotency approach if needed, 
      // but here we just insert normally. We strip local-only fields.
      const payload = { ...visit };
      delete payload.sync_status;
      
      const { error: insertError } = await supabase
        .from('field_visits')
        .insert(payload);

      // If it fails with a unique constraint, it might already exist. We can ignore or handle.
      if (insertError && !insertError.message.includes('duplicate key value')) {
        throw new Error(`Visit insert failed: ${insertError.message}`);
      }

      // 4. Also backup the raw media into field_visit_media if needed by backend (optional, based on requirement #5)
      // "Create public.field_visit_media to hold raw base64 backups if needed by backend operations"
      if (mediaRecord) {
        const { error: mediaInsertError } = await supabase
          .from('field_visit_media')
          .insert(mediaRecord);
          
        if (mediaInsertError && !mediaInsertError.message.includes('duplicate key value')) {
          console.warn(`Media backup insert failed: ${mediaInsertError.message}`);
          // Don't fail the whole sync if the backup fails, storage upload was the primary.
        }
      }

      // 5. Mark as synced locally
      await db.field_visits.update(visit.visit_id, { sync_status: 'synced' });
      
      // Cleanup local media to free space now that it is synced
      if (mediaRecord) {
        await db.field_visit_media.delete(mediaRecord.media_id);
      }

    } catch (err) {
      console.warn(`Failed to sync field visit ${visit.visit_id}:`, err);
      // Mark as failed so we can retry or show amber UI
      await db.field_visits.update(visit.visit_id, { sync_status: 'sync_failed' });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTO SYNC ORCHESTRATION FOR FIELD VISITS
// ─────────────────────────────────────────────────────────────────────────────

if (typeof window !== "undefined") {
  window.addEventListener("online", () => {
    console.log("Browser went online. Triggering Field Visits sync...");
    syncFieldVisits().catch(console.error);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && navigator.onLine) {
       console.log("Tab focused. Triggering Field Visits sync...");
       syncFieldVisits().catch(console.error);
    }
  });
}
