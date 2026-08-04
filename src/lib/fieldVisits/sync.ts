import { db, processSyncQueue, type LocalFieldVisit } from "../db";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

export type FieldVisitSafeCode =
  | "AUTH_REQUIRED" | "ACCOUNT_INACTIVE" | "CAPABILITY_MISMATCH"
  | "ATTENDANCE_NOT_CONFIRMED" | "VISIT_VALIDATION_FAILED"
  | "VISIT_INSERT_FAILED" | "VISIT_CONFIRMATION_FAILED"
  | "EVIDENCE_UPLOAD_FAILED" | "NETWORK_UNAVAILABLE" | "UNKNOWN_SYNC_FAILURE";

export interface FieldVisitSyncSummary {
  confirmed: number;
  alreadyConfirmed: number;
  evidencePending: number;
  failed: number;
  failureCodes: FieldVisitSafeCode[];
}

interface ConfirmResponse {
  ok: boolean;
  code: "VISIT_CONFIRMED" | "VISIT_CONFIRMED_EVIDENCE_PENDING" | FieldVisitSafeCode;
  message?: string;
  visit_id?: string;
  already_confirmed?: boolean;
  evidence_confirmed?: boolean;
  selfie_storage_path?: string;
}

const SAFE_MESSAGES: Record<FieldVisitSafeCode, string> = {
  AUTH_REQUIRED: "Sign in again before retrying this visit.",
  ACCOUNT_INACTIVE: "Your account is inactive. Contact an administrator.",
  CAPABILITY_MISMATCH: "Your account is not permitted to confirm this visit.",
  ATTENDANCE_NOT_CONFIRMED: "Attendance is not yet confirmed. Retry synchronization.",
  VISIT_VALIDATION_FAILED: "Review the visit details and retry.",
  VISIT_INSERT_FAILED: "The visit was retained locally and will retry.",
  VISIT_CONFIRMATION_FAILED: "The exact visit could not be confirmed.",
  EVIDENCE_UPLOAD_FAILED: "The visit is confirmed; selfie evidence will retry automatically.",
  NETWORK_UNAVAILABLE: "No network connection. The visit remains saved offline.",
  UNKNOWN_SYNC_FAILURE: "The visit remains saved locally and will retry.",
};

let activeSync: Promise<FieldVisitSyncSummary> | null = null;
let rerunRequested = false;
let listenersRegistered = false;

function emptySummary(): FieldVisitSyncSummary {
  return { confirmed: 0, alreadyConfirmed: 0, evidencePending: 0, failed: 0, failureCodes: [] };
}

function mergeSummary(target: FieldVisitSyncSummary, next: FieldVisitSyncSummary) {
  target.confirmed += next.confirmed;
  target.alreadyConfirmed += next.alreadyConfirmed;
  target.evidencePending += next.evidencePending;
  target.failed += next.failed;
  target.failureCodes = [...new Set([...target.failureCodes, ...next.failureCodes])];
}

function safeCode(value: unknown): FieldVisitSafeCode {
  return typeof value === "string" && value in SAFE_MESSAGES ? value as FieldVisitSafeCode : "UNKNOWN_SYNC_FAILURE";
}

async function mediaToBlob(media: Blob | string): Promise<Blob> {
  if (media instanceof Blob) return media;
  const response = await fetch(media);
  if (!response.ok) throw new Error("LEGACY_MEDIA_UNREADABLE");
  return response.blob();
}

/** Explicit remote whitelist. Local diagnostics and media are never serialized here. */
export function buildFieldVisitConfirmPayload(visit: LocalFieldVisit) {
  return {
    visit_id: visit.visit_id,
    lead_id: visit.lead_id,
    user_id: visit.user_id,
    visit_date: visit.visit_date,
    check_in_time: visit.check_in_time,
    check_in_lat: visit.check_in_lat,
    check_in_lng: visit.check_in_lng,
    location_accuracy_m: visit.location_accuracy_m ?? null,
    location_captured_at: visit.location_captured_at ?? null,
    location_acquisition_mode: visit.location_acquisition_mode ?? null,
    location_quality: visit.location_quality ?? null,
    check_in_photo_url: visit.check_in_photo_url,
    selfie_captured_at: visit.selfie_captured_at ?? null,
    selfie_capture_method: visit.selfie_capture_method ?? null,
    selfie_storage_path: visit.selfie_storage_path ?? null,
    visit_outcome: visit.visit_outcome,
    visit_notes: visit.visit_notes,
    attendance_id: visit.attendance_id ?? null,
    person_met: visit.person_met ?? null,
    segment_type: visit.segment_type,
    follow_up_date: visit.follow_up_date ?? null,
    created_at: visit.created_at,
    updated_at: visit.updated_at,
  };
}

export async function syncFieldVisits(onlyVisitId?: string, ownerUserId?: string): Promise<FieldVisitSyncSummary> {
  if (activeSync) {
    rerunRequested = true;
    return activeSync;
  }
  activeSync = (async () => {
    const total = emptySummary();
    let targetVisitId = onlyVisitId;
    let targetOwnerUserId = ownerUserId;
    do {
      rerunRequested = false;
      mergeSummary(total, await runSyncCycle(targetVisitId, targetOwnerUserId));
      targetVisitId = undefined;
      targetOwnerUserId = undefined;
    } while (rerunRequested);
    return total;
  })().finally(() => { activeSync = null; });
  return activeSync;
}

async function runSyncCycle(onlyVisitId?: string, ownerUserId?: string): Promise<FieldVisitSyncSummary> {
  const summary = emptySummary();
  if (typeof navigator === "undefined" || !navigator.onLine || !isSupabaseConfigured) {
    summary.failed = await markKnownUserFailures(onlyVisitId, ownerUserId, "NETWORK_UNAVAILABLE");
    summary.failureCodes.push("NETWORK_UNAVAILABLE");
    return summary;
  }

  await processSyncQueue();
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const authenticatedUserId = sessionData.session?.user.id;
  if (!token || !authenticatedUserId) {
    summary.failed = await markKnownUserFailures(onlyVisitId, ownerUserId, "AUTH_REQUIRED");
    summary.failureCodes.push("AUTH_REQUIRED");
    return summary;
  }

  const ownVisits = await db.field_visits.where("user_id").equals(authenticatedUserId).toArray();
  const visits = ownVisits.filter((visit, index, rows) =>
    (!onlyVisitId || visit.visit_id === onlyVisitId) &&
    (visit.sync_status === "pending_sync" || visit.sync_status === "sync_failed" || visit.sync_stage === "pending_visit" || visit.sync_stage === "sync_failed" || visit.sync_stage === "visit_confirmed_evidence_pending") &&
    rows.findIndex((candidate) => candidate.visit_id === visit.visit_id) === index,
  );

  for (const visit of visits) {
    const attemptedAt = new Date().toISOString();
    await db.field_visits.update(visit.visit_id, {
      last_sync_attempt_at: attemptedAt,
      sync_attempt_count: (visit.sync_attempt_count ?? 0) + 1,
      sync_error_code: undefined,
      sync_error_message: undefined,
    });
    try {
      const mediaRecord = (await db.field_visit_media.where("visit_id").equals(visit.visit_id).toArray())[0] ?? null;
      const form = new FormData();
      form.set("visit", JSON.stringify(buildFieldVisitConfirmPayload(visit)));
      if (mediaRecord?.media_data) {
        const evidence = await mediaToBlob(mediaRecord.media_data);
        form.set("selfie", new File([evidence], "selfie.jpg", { type: evidence.type || "image/jpeg" }));
      }
      const response = await fetch("/api/field-visits/confirm", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
        cache: "no-store",
      });
      let result: ConfirmResponse;
      try { result = await response.json() as ConfirmResponse; }
      catch { throw new Error("UNKNOWN_SYNC_FAILURE"); }

      if (result.visit_id && result.visit_id !== visit.visit_id) throw new Error("VISIT_CONFIRMATION_FAILED");
      if (result.ok && result.code === "VISIT_CONFIRMED" && (!mediaRecord || result.evidence_confirmed)) {
        await db.field_visits.update(visit.visit_id, {
          sync_status: "synced", sync_stage: "synced",
          selfie_storage_path: result.selfie_storage_path ?? visit.selfie_storage_path,
          sync_error_code: undefined, sync_error_message: undefined,
        });
        if (result.evidence_confirmed && mediaRecord) await db.field_visit_media.delete(mediaRecord.media_id);
        if (result.already_confirmed) summary.alreadyConfirmed++;
        else summary.confirmed++;
      } else if (result.ok && (result.code === "VISIT_CONFIRMED_EVIDENCE_PENDING" || (result.code === "VISIT_CONFIRMED" && Boolean(mediaRecord) && !result.evidence_confirmed))) {
        await db.field_visits.update(visit.visit_id, {
          sync_status: "pending_sync", sync_stage: "visit_confirmed_evidence_pending",
          sync_error_code: "EVIDENCE_UPLOAD_FAILED",
          sync_error_message: SAFE_MESSAGES.EVIDENCE_UPLOAD_FAILED,
        });
        summary.evidencePending++;
        summary.failureCodes = [...new Set([...summary.failureCodes, "EVIDENCE_UPLOAD_FAILED"])] as FieldVisitSafeCode[];
      } else {
        const code = safeCode(result.code);
        await markFailure(visit.visit_id, code);
        summary.failed++;
        summary.failureCodes = [...new Set([...summary.failureCodes, code])];
      }
    } catch (error) {
      const code = error instanceof Error ? safeCode(error.message) : "UNKNOWN_SYNC_FAILURE";
      await markFailure(visit.visit_id, code);
      summary.failed++;
      summary.failureCodes = [...new Set([...summary.failureCodes, code])];
    }
  }
  return summary;
}

async function markFailure(visitId: string, code: FieldVisitSafeCode) {
  await db.field_visits.update(visitId, {
    sync_status: "sync_failed",
    sync_stage: "sync_failed",
    sync_error_code: code,
    sync_error_message: SAFE_MESSAGES[code],
  });
}

async function markKnownUserFailures(onlyVisitId: string | undefined, ownerUserId: string | undefined, code: FieldVisitSafeCode): Promise<number> {
  if (onlyVisitId) {
    await markFailure(onlyVisitId, code);
    return 1;
  }
  const knownOwner = ownerUserId ?? (typeof localStorage !== "undefined" ? localStorage.getItem("authenticated_user_id") ?? undefined : undefined);
  if (!knownOwner) return 0;
  const rows = await db.field_visits.where("user_id").equals(knownOwner).toArray();
  const retryable = rows.filter((visit) => visit.sync_status === "pending_sync" || visit.sync_status === "sync_failed" || visit.sync_stage === "pending_visit" || visit.sync_stage === "sync_failed" || visit.sync_stage === "visit_confirmed_evidence_pending");
  await Promise.all(retryable.map((visit) => markFailure(visit.visit_id, code)));
  return retryable.length;
}

function handleOnline(): void { void syncFieldVisits(); }
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
