import { db, processSyncQueue, type LocalFieldVisit } from "../db";
import { supabase, isSupabaseConfigured } from "../supabaseClient";

export type FieldVisitSafeCode =
  | "AUTH_REQUIRED" | "ACCOUNT_INACTIVE" | "CAPABILITY_MISMATCH"
  | "ADDRESS_REQUIRED"
  | "PINCODE_REQUIRED"
  | "ATTENDANCE_NOT_CONFIRMED" | "ATTENDANCE_INTEGRITY_ERROR" | "VISIT_VALIDATION_FAILED"
  | "VISIT_INSERT_FAILED" | "VISIT_CONFIRMATION_FAILED"
  | "EVIDENCE_UPLOAD_FAILED" | "NETWORK_UNAVAILABLE" | "NETWORK_OR_SERVER_RESPONSE_FAILED"
  | "REFERENCE_CONSTRAINT_FAILED" | "VISIT_CONSTRAINT_FAILED" | "OPTIONAL_SCHEMA_MISMATCH"
  | "SERVER_AUTHORIZATION_FAILED" | "BUSINESS_REFERENCE_WARNING" | "ATTENDANCE_LINK_PENDING"
  | "VISIT_ID_OWNERSHIP_COLLISION" | "UNKNOWN_SYNC_FAILURE";

export interface FieldVisitSyncSummary {
  locallyFound: number;
  confirmed: number;
  alreadyConfirmed: number;
  evidencePending: number;
  attendanceBlocked: number;
  referenceCompatibleRecoveries: number;
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
  warning_codes?: FieldVisitSafeCode[];
}

const SAFE_MESSAGES: Record<FieldVisitSafeCode, string> = {
  AUTH_REQUIRED: "Sign in again before retrying this visit.",
  ADDRESS_REQUIRED: "Address required before this queued visit can sync.",
  PINCODE_REQUIRED: "Pincode required before this current-contract visit can sync.",
  ACCOUNT_INACTIVE: "Your account is inactive. Contact an administrator.",
  CAPABILITY_MISMATCH: "Your account is not permitted to confirm this visit.",
  ATTENDANCE_NOT_CONFIRMED: "Attendance is not yet confirmed. Retry synchronization.",
  ATTENDANCE_INTEGRITY_ERROR: "Multiple attendance records require administrator review.",
  VISIT_VALIDATION_FAILED: "Review the visit details and retry.",
  VISIT_INSERT_FAILED: "The visit was retained locally and will retry.",
  VISIT_CONFIRMATION_FAILED: "The exact visit could not be confirmed.",
  EVIDENCE_UPLOAD_FAILED: "The visit is confirmed; selfie evidence will retry automatically.",
  NETWORK_UNAVAILABLE: "No network connection. The visit remains saved offline.",
  NETWORK_OR_SERVER_RESPONSE_FAILED: "The server response could not be confirmed. The visit remains saved locally.",
  REFERENCE_CONSTRAINT_FAILED: "A required database reference could not be confirmed.",
  VISIT_CONSTRAINT_FAILED: "The visit does not match the current database rules.",
  OPTIONAL_SCHEMA_MISMATCH: "The visit is confirmed; optional evidence fields require compatibility review.",
  SERVER_AUTHORIZATION_FAILED: "The server could not authorize this write.",
  BUSINESS_REFERENCE_WARNING: "Visit confirmed with its original historical business reference.",
  ATTENDANCE_LINK_PENDING: "Visit confirmed; attendance will link automatically when available.",
  VISIT_ID_OWNERSHIP_COLLISION: "This visit ID belongs to another account.",
  UNKNOWN_SYNC_FAILURE: "The visit remains saved locally and will retry.",
};

const MAX_TRANSIENT_BACKOFF_MS = 5 * 60 * 1000;
function nextTransientAttempt(attemptCount: number): string {
  const delay = Math.min(MAX_TRANSIENT_BACKOFF_MS, 1000 * 2 ** Math.min(Math.max(attemptCount, 1), 8));
  return new Date(Date.now() + delay).toISOString();
}

interface SyncRequest {
  onlyVisitId?: string;
  ownerUserId?: string;
  mode: "new" | "recovery";
  resolve: Array<(summary: FieldVisitSyncSummary) => void>;
  reject: Array<(error: unknown) => void>;
}
const syncRequests: SyncRequest[] = [];
let activeSync: Promise<void> | null = null;
let activeRequest: SyncRequest | null = null;

function startSyncDrain(): void {
  if (activeSync) return;
  activeSync = (async () => {
    while (syncRequests.length) {
      const request = syncRequests.shift()!;
      activeRequest = request;
      try {
        const summary = await runSyncCycle(request.onlyVisitId, request.ownerUserId, request.mode);
        request.resolve.forEach((resolve) => resolve(summary));
      } catch (error) {
        request.reject.forEach((reject) => reject(error));
      } finally { activeRequest = null; }
    }
  })().finally(() => {
    activeSync = null;
    if (syncRequests.length) startSyncDrain();
  });
}
let listenersRegistered = false;

function emptySummary(): FieldVisitSyncSummary {
  return { locallyFound: 0, confirmed: 0, alreadyConfirmed: 0, evidencePending: 0, attendanceBlocked: 0, referenceCompatibleRecoveries: 0, failed: 0, failureCodes: [] };
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
    address: visit.address ?? null,
    pincode: visit.pincode ?? null,
    ...(visit.pincode_contract_version ? { pincode_contract_version: visit.pincode_contract_version } : {}),
    ...(visit.erp_contract_version ? {
      erp_contract_version: visit.erp_contract_version,
      erp_usage_state: visit.erp_usage_state ?? null,
      erp_name_input: visit.erp_name_input ?? null,
      erp_id: visit.erp_id ?? null,
      erp_name: visit.erp_name ?? null,
    } : {}),
    segment_type: visit.segment_type,
    follow_up_date: visit.follow_up_date ?? null,
    created_at: visit.created_at,
    updated_at: visit.updated_at,
  };
}

export function resolveVisitConfirmationMode(visit: LocalFieldVisit, requestedMode: "new" | "recovery"): "new" | "recovery" {
  if (visit.pincode_contract_version === 1 && visit.confirmation_mode === "new") return "new";
  if (requestedMode === "new" && visit.pincode_contract_version !== 1) return "recovery";
  return requestedMode;
}

export async function syncFieldVisits(onlyVisitId?: string, ownerUserId?: string, mode: "new" | "recovery" = "recovery"): Promise<FieldVisitSyncSummary> {
  const result = new Promise<FieldVisitSyncSummary>((resolve, reject) => {
    const duplicate = [activeRequest, ...syncRequests].find((request) => request && (onlyVisitId ? request.onlyVisitId === onlyVisitId : !request.onlyVisitId && request.ownerUserId === ownerUserId));
    if (duplicate) {
      if (mode === "new") duplicate.mode = "new";
      duplicate.resolve.push(resolve); duplicate.reject.push(reject);
    } else syncRequests.push({ onlyVisitId, ownerUserId, mode, resolve: [resolve], reject: [reject] });
  });
  startSyncDrain();
  return result;
}

async function runSyncCycle(onlyVisitId?: string, ownerUserId?: string, mode: "new" | "recovery" = "recovery"): Promise<FieldVisitSyncSummary> {
  const summary = emptySummary();
  if (typeof navigator === "undefined" || !navigator.onLine || !isSupabaseConfigured) {
    summary.failed = await markKnownUserFailures(onlyVisitId, ownerUserId, "NETWORK_UNAVAILABLE");
    summary.locallyFound = summary.failed;
    summary.failureCodes.push("NETWORK_UNAVAILABLE");
    return summary;
  }

  await processSyncQueue();
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  const authenticatedUserId = sessionData.session?.user.id;
  if (!token || !authenticatedUserId) {
    summary.failed = await markKnownUserFailures(onlyVisitId, ownerUserId, "AUTH_REQUIRED");
    summary.locallyFound = summary.failed;
    summary.failureCodes.push("AUTH_REQUIRED");
    return summary;
  }

  const ownVisits = await db.field_visits.where("user_id").equals(authenticatedUserId).toArray();
  const visits = ownVisits.filter((visit, index, rows) =>
    (!onlyVisitId || visit.visit_id === onlyVisitId) &&
    visit.sync_stage !== "address_required" && visit.sync_stage !== "pincode_required" && visit.sync_stage !== "review_required" &&
    (visit.sync_status === "pending_sync" || visit.sync_status === "sync_failed" || visit.sync_stage === "pending_visit" || visit.sync_stage === "sync_failed" || visit.sync_stage === "visit_confirmed_evidence_pending" || visit.sync_stage === "visit_confirmed_link_pending") &&
    (!visit.next_sync_attempt_at || Boolean(onlyVisitId) || Date.parse(visit.next_sync_attempt_at) <= Date.now()) &&
    rows.findIndex((candidate) => candidate.visit_id === visit.visit_id) === index,
  );
  summary.locallyFound = visits.length;

  for (const visit of visits) {
    if (!visit.address?.trim()) {
      await db.field_visits.update(visit.visit_id, {
        sync_status: "sync_failed",
        sync_stage: "address_required",
        sync_error_code: "ADDRESS_REQUIRED",
        sync_error_message: SAFE_MESSAGES.ADDRESS_REQUIRED,
      });
      summary.failed++;
      summary.failureCodes = [...new Set([...summary.failureCodes, "ADDRESS_REQUIRED" as FieldVisitSafeCode])];
      continue;
    }
    if (visit.pincode_contract_version === 1 && !visit.pincode?.trim()) {
      await db.field_visits.update(visit.visit_id, {
        sync_status: "sync_failed",
        sync_stage: "pincode_required",
        sync_error_code: "PINCODE_REQUIRED",
        sync_error_message: SAFE_MESSAGES.PINCODE_REQUIRED,
      });
      summary.failed++;
      summary.failureCodes = [...new Set([...summary.failureCodes, "PINCODE_REQUIRED" as FieldVisitSafeCode])];
      continue;
    }
    const attemptedAt = new Date().toISOString();
    await db.field_visits.update(visit.visit_id, {
      last_sync_attempt_at: attemptedAt,
      sync_attempt_count: (visit.sync_attempt_count ?? 0) + 1,
      sync_error_code: undefined,
      sync_error_message: undefined,
      next_sync_attempt_at: undefined,
    });
    try {
      const mediaRecord = (await db.field_visit_media.where("visit_id").equals(visit.visit_id).toArray())[0] ?? null;
      const effectiveMode = resolveVisitConfirmationMode(visit, mode);
      const form = new FormData();
      form.set("mode", effectiveMode);
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
      catch { throw new Error("NETWORK_OR_SERVER_RESPONSE_FAILED"); }

      if (result.visit_id && result.visit_id !== visit.visit_id) throw new Error("VISIT_CONFIRMATION_FAILED");
      const warnings = (result.warning_codes ?? []).map(safeCode);
      if (warnings.includes("BUSINESS_REFERENCE_WARNING")) summary.referenceCompatibleRecoveries++;
      if (result.ok && result.code === "VISIT_CONFIRMED" && (!mediaRecord || result.evidence_confirmed)) {
        const retainedWarning = warnings[0];
        const attendanceLinkPending = warnings.includes("ATTENDANCE_LINK_PENDING");
        await db.field_visits.update(visit.visit_id, {
              sync_status: "synced", sync_stage: attendanceLinkPending ? "visit_confirmed_link_pending" : "synced",
              confirmation_mode: "recovery",
          selfie_storage_path: result.selfie_storage_path ?? visit.selfie_storage_path,
          sync_error_code: retainedWarning,
          sync_error_message: retainedWarning ? SAFE_MESSAGES[retainedWarning] : undefined,
        });
        if (result.already_confirmed) summary.alreadyConfirmed++;
        else summary.confirmed++;
      } else if (result.ok && (result.code === "VISIT_CONFIRMED_EVIDENCE_PENDING" || (result.code === "VISIT_CONFIRMED" && Boolean(mediaRecord) && !result.evidence_confirmed))) {
        await db.field_visits.update(visit.visit_id, {
              sync_status: "synced", sync_stage: "visit_confirmed_evidence_pending",
              confirmation_mode: "recovery",
          sync_error_code: "EVIDENCE_UPLOAD_FAILED",
          sync_error_message: SAFE_MESSAGES.EVIDENCE_UPLOAD_FAILED,
        });
        summary.evidencePending++;
        summary.failureCodes = [...new Set([...summary.failureCodes, "EVIDENCE_UPLOAD_FAILED"])] as FieldVisitSafeCode[];
      } else {
        const code = safeCode(result.code);
        const terminal = response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429;
        await markFailure(visit.visit_id, code, terminal);
        if (code === "ATTENDANCE_NOT_CONFIRMED" || code === "ATTENDANCE_INTEGRITY_ERROR") summary.attendanceBlocked++;
        summary.failed++;
        summary.failureCodes = [...new Set([...summary.failureCodes, code])];
      }
    } catch (error) {
      const code = error instanceof TypeError
        ? "NETWORK_OR_SERVER_RESPONSE_FAILED"
        : error instanceof Error ? safeCode(error.message) : "UNKNOWN_SYNC_FAILURE";
      await markFailure(visit.visit_id, code);
      summary.failed++;
      summary.failureCodes = [...new Set([...summary.failureCodes, code])];
    }
  }
  return summary;
}

export async function supplyQueuedVisitAddress(visitId: string, ownerUserId: string, address: string): Promise<void> {
  const normalized = address.trim();
  if (!normalized || normalized.length > 500) throw new Error("Address must be between 1 and 500 characters.");
  const visit = await db.field_visits.get(visitId);
  if (!visit || visit.user_id !== ownerUserId) throw new Error("Queued visit is unavailable for this account.");
  if (visit.sync_stage !== "address_required" && visit.sync_error_code !== "ADDRESS_REQUIRED") throw new Error("This visit is not waiting for an address.");
  await db.field_visits.update(visitId, {
    address: normalized,
    sync_status: "pending_sync",
    sync_stage: "pending_visit",
    sync_error_code: undefined,
    sync_error_message: undefined,
    updated_at: new Date().toISOString(),
  });
}

export async function supplyQueuedVisitPincode(visitId: string, ownerUserId: string, pincode: string): Promise<void> {
  const normalized = pincode.trim();
  if (!normalized || normalized.length > 32) throw new Error("Pincode must be between 1 and 32 characters.");
  const visit = await db.field_visits.get(visitId);
  if (!visit || visit.user_id !== ownerUserId) throw new Error("Queued visit is unavailable for this account.");
  if (visit.sync_stage !== "pincode_required" && visit.sync_error_code !== "PINCODE_REQUIRED") throw new Error("This visit is not waiting for a pincode.");
  await db.field_visits.update(visitId, {
    pincode: normalized,
    pincode_contract_version: 1,
    sync_status: "pending_sync",
    sync_stage: "pending_visit",
    sync_error_code: undefined,
    sync_error_message: undefined,
    next_sync_attempt_at: undefined,
    updated_at: new Date().toISOString(),
  });
}

async function markFailure(visitId: string, code: FieldVisitSafeCode, terminal = false) {
  const current = await db.field_visits.get(visitId);
  if (current?.sync_stage === "visit_confirmed_evidence_pending" || current?.sync_stage === "visit_confirmed_link_pending") {
    await db.field_visits.update(visitId, {
      sync_status: "synced",
      sync_stage: current.sync_stage,
      sync_error_code: code,
      sync_error_message: SAFE_MESSAGES[code],
    });
    return;
  }
  await db.field_visits.update(visitId, {
    sync_status: "sync_failed",
    sync_stage: terminal ? "review_required" : "sync_failed",
    sync_error_code: code,
    sync_error_message: SAFE_MESSAGES[code],
    next_sync_attempt_at: terminal ? undefined : nextTransientAttempt((current?.sync_attempt_count ?? 0) + 1),
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
  const retryable = rows.filter((visit) => visit.sync_stage !== "address_required" && visit.sync_stage !== "pincode_required" && visit.sync_stage !== "review_required" && (visit.sync_status === "pending_sync" || visit.sync_status === "sync_failed" || visit.sync_stage === "pending_visit" || visit.sync_stage === "sync_failed" || visit.sync_stage === "visit_confirmed_evidence_pending" || visit.sync_stage === "visit_confirmed_link_pending"));
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
