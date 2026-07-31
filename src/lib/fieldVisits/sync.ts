import { db } from "../db";
import { supabase, isSupabaseConfigured } from "../supabaseClient";
import { generateEvidencePath } from "./contract";

let activeSync: Promise<void> | null = null;
let rerunRequested = false;
let listenersRegistered = false;

async function mediaToBlob(media: Blob | string): Promise<Blob> {
  if (media instanceof Blob) return media;
  const response = await fetch(media);
  if (!response.ok) throw new Error("Legacy visit evidence could not be read.");
  return response.blob();
}

function isAlreadyStored(error: { message?: string; statusCode?: string | number } | null): boolean {
  if (!error) return false;
  return Number(error.statusCode) === 409 || /already exists|duplicate/i.test(error.message ?? "");
}

/**
 * Synchronizes retryable visits through one process-wide cycle. A retry keeps
 * the same visit_id and evidence until Supabase confirms that exact visit_id.
 */
export async function syncFieldVisits(onlyVisitId?: string): Promise<void> {
  if (activeSync) {
    rerunRequested = true;
    return activeSync;
  }
  activeSync = (async () => {
    let targetVisitId = onlyVisitId;
    do {
      rerunRequested = false;
      await runSyncCycle(targetVisitId);
      targetVisitId = undefined;
    } while (rerunRequested);
  })().finally(() => {
    activeSync = null;
  });
  return activeSync;
}

async function runSyncCycle(onlyVisitId?: string): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.onLine || !isSupabaseConfigured) return;

  const { data: userData, error: userError } = await supabase.auth.getUser();
  const authenticatedUserId = userData.user?.id;
  if (userError || !authenticatedUserId) return;

  const retryableVisits = await db.field_visits
    .where("sync_status")
    .anyOf(["pending_sync", "sync_failed"])
    .toArray();
  const visits = retryableVisits.filter(
    (visit, index, rows) =>
      visit.user_id === authenticatedUserId &&
      (!onlyVisitId || visit.visit_id === onlyVisitId) &&
      rows.findIndex((candidate) => candidate.visit_id === visit.visit_id) === index,
  );

  for (const visit of visits) {
    try {
      const mediaRecord = (
        await db.field_visit_media.where("visit_id").equals(visit.visit_id).toArray()
      )[0] ?? null;
      let selfieStoragePath = visit.selfie_storage_path ?? null;

      if (mediaRecord?.media_data) {
        const evidenceBlob = await mediaToBlob(mediaRecord.media_data);
        const evidenceFile = new File([evidenceBlob], "selfie.jpg", { type: "image/jpeg" });
        selfieStoragePath = generateEvidencePath(
          authenticatedUserId,
          visit.visit_date,
          visit.visit_id,
        );
        const { error: uploadError } = await supabase.storage
          .from("visits-evidence")
          .upload(selfieStoragePath, evidenceFile, { upsert: false });
        if (uploadError && !isAlreadyStored(uploadError)) {
          throw new Error(`Media upload failed: ${uploadError.message}`);
        }
      }

      const payload = { ...visit, selfie_storage_path: selfieStoragePath };
      delete payload.sync_status;
      const { data: insertedVisit, error: insertError } = await supabase
        .from("field_visits")
        .insert(payload)
        .select("visit_id")
        .single();
      let confirmedVisit = insertedVisit;
      if (insertError?.code === "23505") {
        const { data: existingVisit, error: confirmationError } = await supabase
          .from("field_visits")
          .select("visit_id")
          .eq("visit_id", visit.visit_id)
          .eq("user_id", authenticatedUserId)
          .maybeSingle();
        if (confirmationError) {
          throw new Error(`Visit confirmation failed: ${confirmationError.message}`);
        }
        confirmedVisit = existingVisit;
      } else if (insertError) {
        throw new Error(`Visit insert failed: ${insertError.message}`);
      }
      if (confirmedVisit?.visit_id !== visit.visit_id) {
        throw new Error("Visit confirmation did not match the local visit ID.");
      }

      await db.field_visits.update(visit.visit_id, {
        sync_status: "synced",
        selfie_storage_path: selfieStoragePath,
      });
      if (mediaRecord) await db.field_visit_media.delete(mediaRecord.media_id);
    } catch (error) {
      console.warn(`Failed to sync field visit ${visit.visit_id}:`, error);
      await db.field_visits.update(visit.visit_id, { sync_status: "sync_failed" });
    }
  }
}

function handleOnline(): void {
  void syncFieldVisits();
}

function handleVisibilityChange(): void {
  if (document.visibilityState === "visible" && navigator.onLine) void syncFieldVisits();
}

export function registerFieldVisitSyncListeners(): void {
  if (typeof window === "undefined" || listenersRegistered) return;
  listenersRegistered = true;
  window.addEventListener("online", handleOnline);
  document.addEventListener("visibilitychange", handleVisibilityChange);
}

registerFieldVisitSyncListeners();
