import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { FIELD_VISIT_OUTCOMES, FIELD_VISIT_SEGMENTS, PincodeSchema, generateEvidencePath } from "@/lib/fieldVisits/contract";
import { getCurrentISTDate, getISTDateKey, isValidISTDateKey } from "@/lib/dateTime";

export const runtime = "nodejs";

const MAX_EVIDENCE_BYTES = 8 * 1024 * 1024;
const uuid = z.string().uuid();
const nullableDateTime = z.string().datetime({ offset: true }).nullable();
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const VisitConfirmationSchema = z.object({
  visit_id: uuid,
  lead_id: z.string().trim().min(1).max(250),
  user_id: uuid,
  visit_date: z.string().refine(isValidISTDateKey),
  check_in_time: z.string().datetime({ offset: true }),
  check_in_lat: z.number().finite().min(-90).max(90).nullable().optional(),
  check_in_lng: z.number().finite().min(-180).max(180).nullable().optional(),
  location_accuracy_m: z.number().finite().positive().max(10000).nullable().optional(),
  location_captured_at: nullableDateTime.optional(),
  location_acquisition_mode: z.enum(["gps", "high_accuracy", "balanced_fallback"]).nullable().optional(),
  location_quality: z.enum(["high", "medium", "good", "acceptable", "low"]).nullable().optional(),
  check_in_photo_url: z.string().max(1000).nullable().optional(),
  selfie_captured_at: nullableDateTime.optional(),
  selfie_capture_method: z.enum(["camera_or_upload", "live_camera", "file_fallback"]).nullable().optional(),
  selfie_storage_path: z.string().max(500).nullable().optional(),
  visit_outcome: z.enum(FIELD_VISIT_OUTCOMES),
  visit_notes: z.string().trim().max(2000).nullable().optional(),
  attendance_id: uuid.nullable().optional(),
  person_met: z.string().trim().min(2).max(120).nullable().optional(),
  address: z.string().trim().min(1).max(500).nullable().optional(),
  pincode: PincodeSchema.nullable().optional(),
  pincode_contract_version: z.literal(1).optional(),
  erp_contract_version: z.literal(1).optional(),
  erp_usage_state: z.enum(["erp", "none"]).nullable().optional(),
  erp_name_input: z.string().trim().max(160).nullable().optional(),
  erp_id: uuid.nullable().optional(),
  erp_name: z.string().trim().max(160).nullable().optional(),
  segment_type: z.enum(FIELD_VISIT_SEGMENTS),
  follow_up_date: z.string().refine(isValidISTDateKey).nullable().optional(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
}).superRefine((visit, ctx) => {
  if (getISTDateKey(visit.check_in_time) !== visit.visit_date) {
    ctx.addIssue({ code: "custom", path: ["visit_date"], message: "Visit date must match India check-in date" });
  }
  if (visit.follow_up_date && visit.follow_up_date < visit.visit_date) {
    ctx.addIssue({ code: "custom", path: ["follow_up_date"], message: "Follow-up date cannot precede visit date" });
  }
  if (["follow_up", "payment_follow_up"].includes(visit.visit_outcome) && !visit.follow_up_date) {
    ctx.addIssue({ code: "custom", path: ["follow_up_date"], message: "Follow-up date is required" });
  }
  if (visit.visit_outcome === "payment_follow_up" && visit.segment_type !== "Distributor") {
    ctx.addIssue({ code: "custom", path: ["visit_outcome"], message: "Payment follow-up requires Distributor segment" });
  }
  if (visit.visit_outcome === "payment_done" && visit.segment_type !== "Distributor") {
    ctx.addIssue({ code: "custom", path: ["visit_outcome"], message: "Payment done requires Distributor segment" });
  }
});

type VisitPayload = z.infer<typeof VisitConfirmationSchema>;
type ConfirmationMode = "new" | "recovery";
type SafeCode =
  | "AUTH_REQUIRED" | "ACCOUNT_INACTIVE" | "CAPABILITY_MISMATCH"
  | "PINCODE_REQUIRED"
  | "ATTENDANCE_NOT_CONFIRMED" | "ATTENDANCE_INTEGRITY_ERROR" | "VISIT_VALIDATION_FAILED"
  | "VISIT_INSERT_FAILED" | "VISIT_CONFIRMATION_FAILED" | "EVIDENCE_UPLOAD_FAILED"
  | "REFERENCE_CONSTRAINT_FAILED" | "VISIT_CONSTRAINT_FAILED" | "OPTIONAL_SCHEMA_MISMATCH"
  | "SERVER_AUTHORIZATION_FAILED" | "NETWORK_OR_SERVER_RESPONSE_FAILED" | "VISIT_ID_OWNERSHIP_COLLISION";
type SafeWarning = "BUSINESS_REFERENCE_WARNING" | "ATTENDANCE_LINK_PENDING" | "OPTIONAL_SCHEMA_MISMATCH";

function response(status: number, code: SafeCode, message: string, extra: Record<string, unknown> = {}) {
  return Response.json({ ok: false, code, message, ...extra }, { status, headers: { "Cache-Control": "no-store" } });
}

function success(body: Record<string, unknown>) {
  return Response.json({ ok: true, ...body }, { headers: { "Cache-Control": "no-store" } });
}

function configuredAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

function getToken(request: Request): string | null {
  const value = request.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() || null : null;
}

function active(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

export function validateNewVisit(visit: VisitPayload): boolean {
  return visit.visit_date === getCurrentISTDate()
    && Boolean(visit.person_met?.trim())
    && Boolean(visit.address?.trim())
    && Boolean(visit.pincode?.trim())
    && visit.check_in_lat !== null && visit.check_in_lat !== undefined
    && visit.check_in_lng !== null && visit.check_in_lng !== undefined
    && Boolean(visit.location_accuracy_m)
    && Boolean(visit.location_captured_at)
    && Boolean(visit.location_acquisition_mode)
    && Boolean(visit.location_quality)
    && (visit.erp_contract_version !== 1 || visit.erp_usage_state === "erp" || visit.erp_usage_state === "none");
}

export function validateLeadCompatibility(
  mode: ConfirmationMode,
  leadId: string,
  segment: string,
  lead: { lead_id: string; segment_type: string } | null,
): { allowed: boolean; warning?: SafeWarning } {
  if (lead && lead.segment_type !== segment) return { allowed: false };
  if (lead) return { allowed: true };
  return { allowed: Boolean(leadId.trim()), warning: "BUSINESS_REFERENCE_WARNING" };
}

export function resolveAttendanceId(
  rows: Array<{ attendance_id: string; user_id: string; date: string }>,
  submittedAttendanceId?: string | null,
): { attendanceId: string | null; integrityError: boolean } {
  if (rows.length > 1) return { attendanceId: null, integrityError: true };
  const submittedMatch = rows.find((row) => row.attendance_id === submittedAttendanceId);
  return { attendanceId: submittedMatch?.attendance_id ?? rows[0]?.attendance_id ?? null, integrityError: false };
}

export function coreRemotePayload(visit: VisitPayload, attendanceId: string | null) {
  return {
    visit_id: visit.visit_id,
    lead_id: visit.lead_id,
    user_id: visit.user_id,
    visit_date: visit.visit_date,
    check_in_time: visit.check_in_time,
    check_in_lat: visit.check_in_lat ?? null,
    check_in_lng: visit.check_in_lng ?? null,
    check_in_photo_url: visit.check_in_photo_url ?? null,
    visit_outcome: visit.visit_outcome,
    visit_notes: visit.visit_notes ?? null,
    attendance_id: attendanceId,
    person_met: visit.person_met ?? null,
    address: visit.address?.trim() ?? null,
    address_contract_version: 1,
    pincode: visit.pincode?.trim() ?? null,
    segment_type: visit.segment_type,
    follow_up_date: visit.follow_up_date ?? null,
    created_at: visit.created_at,
    updated_at: visit.updated_at,
  };
}

export function optionalRemotePayload(visit: VisitPayload) {
  return {
    location_accuracy_m: visit.location_accuracy_m ?? null,
    location_captured_at: visit.location_captured_at ?? null,
    location_acquisition_mode: visit.location_acquisition_mode ?? null,
    location_quality: visit.location_quality ?? null,
    selfie_captured_at: visit.selfie_captured_at ?? null,
    selfie_capture_method: visit.selfie_capture_method ?? null,
    selfie_storage_path: null,
    erp_contract_version: visit.erp_contract_version,
    erp_usage_state: visit.erp_usage_state,
    erp_name_input: visit.erp_name_input ?? visit.erp_name ?? null,
    erp_id: visit.erp_id ?? null,
  };
}

function mapInsertError(code: string | undefined): SafeCode {
  if (code === "23503") return "REFERENCE_CONSTRAINT_FAILED";
  if (code === "23514") return "VISIT_CONSTRAINT_FAILED";
  if (code === "42703" || code === "PGRST204") return "OPTIONAL_SCHEMA_MISMATCH";
  if (code === "42501") return "SERVER_AUTHORIZATION_FAILED";
  return "VISIT_INSERT_FAILED";
}

async function equalEvidence(admin: SupabaseClient, path: string, incoming: Blob): Promise<boolean> {
  const { data, error } = await admin.storage.from("visits-evidence").download(path);
  if (error || !data || data.size !== incoming.size) return false;
  const [storedHash, incomingHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", await data.arrayBuffer()),
    crypto.subtle.digest("SHA-256", await incoming.arrayBuffer()),
  ]);
  return Buffer.from(storedHash).equals(Buffer.from(incomingHash));
}

export async function POST(request: Request) {
  const admin = configuredAdmin();
  const token = getToken(request);
  if (!admin || !token) return response(401, "AUTH_REQUIRED", "Sign in again before retrying this visit.");

  const { data: auth, error: authError } = await admin.auth.getUser(token);
  if (authError || !auth.user) return response(401, "AUTH_REQUIRED", "Sign in again before retrying this visit.");

  const [{ data: account, error: accountError }, { data: capabilityRows, error: capabilityError }] = await Promise.all([
    admin.from("users").select("user_id,is_active").eq("user_id", auth.user.id).maybeSingle(),
    admin.from("user_capabilities").select("capability_code").eq("user_id", auth.user.id),
  ]);
  if (accountError || !account || !active(account.is_active)) return response(403, "ACCOUNT_INACTIVE", "Your account is inactive. Contact an administrator.");
  if (capabilityError) return response(403, "CAPABILITY_MISMATCH", "Your field-visit permission could not be confirmed.");

  let form: FormData;
  try { form = await request.formData(); }
  catch { return response(400, "NETWORK_OR_SERVER_RESPONSE_FAILED", "The visit submission could not be read."); }
  const modeValue = form.get("mode");
  const mode: ConfirmationMode = modeValue === "new" ? "new" : modeValue === "recovery" ? "recovery" : "recovery";
  const rawVisit = form.get("visit");
  if (typeof rawVisit !== "string") return response(400, "VISIT_VALIDATION_FAILED", "Visit details are required.");
  let parsedJson: unknown;
  try { parsedJson = JSON.parse(rawVisit); }
  catch { return response(400, "NETWORK_OR_SERVER_RESPONSE_FAILED", "Visit details could not be read."); }
  const parsed = VisitConfirmationSchema.safeParse(parsedJson);
  if (!parsed.success) return response(400, "VISIT_VALIDATION_FAILED", "Review the visit details and retry.");
  const visit = parsed.data;
  if (visit.user_id !== auth.user.id) return response(403, "CAPABILITY_MISMATCH", "This visit belongs to a different account.");
  if ((mode === "new" && visit.pincode_contract_version !== 1) || (visit.pincode_contract_version === 1 && !visit.pincode)) {
    return response(422, "PINCODE_REQUIRED", "Pincode is required for new visits.");
  }
  if (mode === "new" && !validateNewVisit(visit)) return response(400, "VISIT_VALIDATION_FAILED", "Current visits require complete person and location details.");

  const capabilities = new Set((capabilityRows ?? []).map((row) => row.capability_code));
  const isAdmin = capabilities.has("admin");
  const allowed = isAdmin || (visit.segment_type === "Retailer" ? capabilities.has("field_ret") : capabilities.has("field_dist"));
  if (!allowed) return response(403, "CAPABILITY_MISMATCH", "Your account is not permitted to confirm this visit segment.");

  const warningCodes: SafeWarning[] = [];
  let lead: { lead_id: string; segment_type: string } | null = null;
  if (UUID_PATTERN.test(visit.lead_id)) {
    const leadResult = await admin.from("leads").select("lead_id,segment_type").eq("lead_id", visit.lead_id).maybeSingle();
    if (leadResult.error) console.error("Field visit lead lookup failed", { code: leadResult.error.code ?? "UNKNOWN" });
    lead = leadResult.data;
  }
  const leadCompatibility = validateLeadCompatibility(mode, visit.lead_id, visit.segment_type, lead);
  if (leadCompatibility.warning) warningCodes.push(leadCompatibility.warning);

  const attendanceResult = await admin.from("attendance").select("attendance_id,user_id,date")
    .eq("user_id", auth.user.id).eq("date", visit.visit_date);
  if (attendanceResult.error) {
    console.error("Field visit attendance lookup failed", { code: attendanceResult.error.code ?? "UNKNOWN" });
    warningCodes.push("ATTENDANCE_LINK_PENDING");
  }
  const attendanceRows = attendanceResult.data ?? [];
  const attendanceResolution = resolveAttendanceId(attendanceRows, visit.attendance_id);
  const resolvedAttendanceId = attendanceResolution.integrityError ? null : attendanceResolution.attendanceId;
  if (attendanceResolution.integrityError) warningCodes.push("ATTENDANCE_LINK_PENDING");
  if (!resolvedAttendanceId && !warningCodes.includes("ATTENDANCE_LINK_PENDING")) warningCodes.push("ATTENDANCE_LINK_PENDING");

  const select = "visit_id,user_id,lead_id,segment_type,selfie_storage_path,selfie_purged_at,erp_id,erp_usage_state,erp_systems(erp_name)";
  const preflight = await admin.from("field_visits").select(select).eq("visit_id", visit.visit_id).maybeSingle();
  if (preflight.error) return response(500, "VISIT_CONFIRMATION_FAILED", "The exact visit could not be checked safely.");
  if (preflight.data && preflight.data.user_id !== auth.user.id) {
    return response(409, "VISIT_ID_OWNERSHIP_COLLISION", "This visit ID belongs to another account.");
  }
  let alreadyConfirmed = Boolean(preflight.data);
  if (!alreadyConfirmed) {
    if (!leadCompatibility.allowed) return response(400, "VISIT_VALIDATION_FAILED", "The selected business reference conflicts with the current business segment.");
    if (visit.erp_contract_version === 1) {
      if (visit.erp_usage_state !== "erp" && visit.erp_usage_state !== "none") return response(422, "VISIT_VALIDATION_FAILED", "ERP_REQUIRED");
      const { data: result, error: rpcError } = await admin.rpc("confirm_field_visit_erp_v1", {
        p_actor_id: auth.user.id,
        p_visit: { ...coreRemotePayload(visit, resolvedAttendanceId), ...optionalRemotePayload(visit), erp_usage_state: visit.erp_usage_state, erp_name_input: visit.erp_name_input ?? visit.erp_name ?? null },
      });
      const rpcCode = typeof result?.code === "string" ? result.code : "";
      if (rpcError || !result?.success) {
        const code = rpcCode === "ERP_REQUIRED" ? "VISIT_VALIDATION_FAILED" : rpcCode === "ERP_INVALID" ? "VISIT_VALIDATION_FAILED" : rpcCode === "VISIT_ID_OWNERSHIP_COLLISION" ? "VISIT_ID_OWNERSHIP_COLLISION" : rpcCode === "CAPABILITY_MISMATCH" ? "CAPABILITY_MISMATCH" : "VISIT_INSERT_FAILED";
        return response(code === "CAPABILITY_MISMATCH" ? 403 : code === "VISIT_ID_OWNERSHIP_COLLISION" ? 409 : 500, code, rpcCode || "ERP_VISIT_CAPABILITY_MISSING");
      }
      alreadyConfirmed = Boolean(result.already_confirmed);
    } else {
      let insertError = (await admin.from("field_visits").insert({ ...coreRemotePayload(visit, resolvedAttendanceId), ...optionalRemotePayload(visit) })).error;
      if (insertError && (insertError.code === "42703" || insertError.code === "PGRST204" || insertError.code === "23514")) {
        console.error("Field visit optional schema mismatch", { code: insertError.code });
        warningCodes.push("OPTIONAL_SCHEMA_MISMATCH");
        insertError = (await admin.from("field_visits").insert(coreRemotePayload(visit, resolvedAttendanceId))).error;
      }
      if (insertError?.code === "23505") alreadyConfirmed = true;
      else if (insertError) {
        const safeCode = mapInsertError(insertError.code);
        console.error("Field visit insert failed", { code: insertError.code ?? "UNKNOWN" });
        return response(safeCode === "SERVER_AUTHORIZATION_FAILED" ? 403 : 500, safeCode, "The visit was retained locally and will retry.");
      }
    }
  } else if (resolvedAttendanceId) {
    const linkResult = await admin.from("field_visits").update({ attendance_id: resolvedAttendanceId })
      .eq("visit_id", visit.visit_id).eq("user_id", auth.user.id);
    if (linkResult.error) warningCodes.push("ATTENDANCE_LINK_PENDING");
    else {
      const warningIndex = warningCodes.indexOf("ATTENDANCE_LINK_PENDING");
      if (warningIndex >= 0) warningCodes.splice(warningIndex, 1);
    }
  }

  const existing = await admin.from("field_visits").select(select).eq("visit_id", visit.visit_id).maybeSingle();
  if (existing.error) {
    console.error("Field visit confirmation read failed", { code: existing.error.code ?? "UNKNOWN" });
    return response(500, "VISIT_CONFIRMATION_FAILED", "The exact visit could not be confirmed.");
  }
  const confirmed = existing.data;
  if (!confirmed || confirmed.visit_id !== visit.visit_id) return response(500, "VISIT_CONFIRMATION_FAILED", "The exact visit could not be confirmed.");
  if (confirmed.user_id !== auth.user.id) return response(409, "VISIT_ID_OWNERSHIP_COLLISION", "This visit ID belongs to another account.");
  if (confirmed.lead_id !== visit.lead_id || confirmed.segment_type !== visit.segment_type) warningCodes.push("BUSINESS_REFERENCE_WARNING");

  const selfie = form.get("selfie");
  if (!(selfie instanceof Blob) || selfie.size === 0 || warningCodes.includes("OPTIONAL_SCHEMA_MISMATCH")) {
    const evidenceConfirmed = Boolean(confirmed.selfie_storage_path);
    return success({
      code: evidenceConfirmed ? "VISIT_CONFIRMED" : "VISIT_CONFIRMED_EVIDENCE_PENDING",
      message: evidenceConfirmed ? "Visit confirmed successfully." : "Visit confirmed. Selfie evidence will retry automatically.",
      visit_id: visit.visit_id, already_confirmed: alreadyConfirmed, evidence_confirmed: evidenceConfirmed,
      warning_codes: warningCodes,
      ...(evidenceConfirmed ? { selfie_storage_path: confirmed.selfie_storage_path } : {}),
    });
  }
  if (selfie.size > MAX_EVIDENCE_BYTES || !selfie.type.startsWith("image/")) {
    return success({ code: "VISIT_CONFIRMED_EVIDENCE_PENDING", message: "Visit confirmed. Selfie evidence will retry automatically.", visit_id: visit.visit_id, already_confirmed: alreadyConfirmed, evidence_confirmed: false, warning_codes: warningCodes });
  }

  const evidencePath = generateEvidencePath(auth.user.id, visit.visit_date, visit.visit_id);
  const upload = await admin.storage.from("visits-evidence").upload(evidencePath, selfie, { contentType: selfie.type || "image/jpeg", upsert: false });
  if (upload.error) {
    const duplicate = Number(upload.error.statusCode) === 409 || /already exists|duplicate/i.test(upload.error.message);
    if (!duplicate || !(await equalEvidence(admin, evidencePath, selfie))) {
      console.error("Field visit evidence upload failed", { code: upload.error.statusCode ?? "UNKNOWN" });
      return success({ code: "VISIT_CONFIRMED_EVIDENCE_PENDING", message: "Visit confirmed. Selfie evidence will retry automatically.", visit_id: visit.visit_id, already_confirmed: alreadyConfirmed, evidence_confirmed: false, warning_codes: warningCodes });
    }
  }

  const { data: updated, error: updateError } = await admin.from("field_visits")
    .update({ selfie_storage_path: evidencePath, selfie_uploaded_at: new Date().toISOString(), selfie_purged_at: null, updated_at: new Date().toISOString() })
    .eq("visit_id", visit.visit_id).eq("user_id", auth.user.id).select("visit_id,selfie_storage_path").maybeSingle();
  if (updateError || updated?.visit_id !== visit.visit_id || updated.selfie_storage_path !== evidencePath) {
    console.error("Field visit evidence link failed", { code: updateError?.code ?? "CONFIRMATION_MISSING" });
    return success({ code: "VISIT_CONFIRMED_EVIDENCE_PENDING", message: "Visit confirmed. Selfie evidence will retry automatically.", visit_id: visit.visit_id, already_confirmed: alreadyConfirmed, evidence_confirmed: false, warning_codes: warningCodes });
  }
  return success({ code: "VISIT_CONFIRMED", message: "Visit confirmed successfully.", visit_id: visit.visit_id, already_confirmed: alreadyConfirmed, evidence_confirmed: true, selfie_storage_path: evidencePath, warning_codes: warningCodes });
}
