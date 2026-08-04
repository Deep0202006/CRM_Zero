import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { FIELD_VISIT_OUTCOMES, FIELD_VISIT_SEGMENTS, generateEvidencePath } from "@/lib/fieldVisits/contract";
import { getISTDateKey, isValidISTDateKey } from "@/lib/dateTime";

export const runtime = "nodejs";

const MAX_EVIDENCE_BYTES = 8 * 1024 * 1024;
const uuid = z.string().uuid();
const nullableDateTime = z.string().datetime({ offset: true }).nullable();

const VisitConfirmationSchema = z.object({
  visit_id: uuid,
  lead_id: uuid,
  user_id: uuid,
  visit_date: z.string().refine(isValidISTDateKey),
  check_in_time: z.string().datetime({ offset: true }),
  check_in_lat: z.number().finite().min(-90).max(90).nullable(),
  check_in_lng: z.number().finite().min(-180).max(180).nullable(),
  location_accuracy_m: z.number().finite().positive().max(10000).nullable().optional(),
  location_captured_at: nullableDateTime.optional(),
  location_acquisition_mode: z.enum(["gps", "high_accuracy", "balanced_fallback"]).nullable().optional(),
  location_quality: z.enum(["high", "medium", "good", "acceptable", "low"]).nullable().optional(),
  check_in_photo_url: z.string().max(1000).nullable(),
  selfie_captured_at: nullableDateTime.optional(),
  selfie_capture_method: z.enum(["camera_or_upload", "live_camera", "file_fallback"]).nullable().optional(),
  selfie_storage_path: z.string().max(500).nullable().optional(),
  visit_outcome: z.enum(FIELD_VISIT_OUTCOMES),
  visit_notes: z.string().trim().max(2000).nullable(),
  attendance_id: uuid.nullable().optional(),
  person_met: z.string().trim().min(2).max(120).nullable().optional(),
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
  const hasLocation = visit.check_in_lat !== null && visit.check_in_lng !== null;
  if (!hasLocation || !visit.location_accuracy_m || !visit.location_captured_at || !visit.location_acquisition_mode || !visit.location_quality) {
    ctx.addIssue({ code: "custom", path: ["location_captured_at"], message: "Complete location evidence is required" });
  }
});

type VisitPayload = z.infer<typeof VisitConfirmationSchema>;
type SafeCode =
  | "AUTH_REQUIRED" | "ACCOUNT_INACTIVE" | "CAPABILITY_MISMATCH"
  | "ATTENDANCE_NOT_CONFIRMED" | "VISIT_VALIDATION_FAILED"
  | "VISIT_INSERT_FAILED" | "VISIT_CONFIRMATION_FAILED" | "EVIDENCE_UPLOAD_FAILED";

function response(status: number, code: SafeCode, message: string, extra: Record<string, unknown> = {}) {
  return Response.json({ ok: false, code, message, ...extra }, { status, headers: { "Cache-Control": "no-store" } });
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

function remotePayload(visit: VisitPayload) {
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
    selfie_storage_path: null,
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
  catch { return response(400, "VISIT_VALIDATION_FAILED", "The visit submission could not be read."); }
  const rawVisit = form.get("visit");
  if (typeof rawVisit !== "string") return response(400, "VISIT_VALIDATION_FAILED", "Visit details are required.");
  let parsedJson: unknown;
  try { parsedJson = JSON.parse(rawVisit); }
  catch { return response(400, "VISIT_VALIDATION_FAILED", "Visit details are invalid."); }
  const parsed = VisitConfirmationSchema.safeParse(parsedJson);
  if (!parsed.success) return response(400, "VISIT_VALIDATION_FAILED", "Review the visit details and retry.");
  const visit = parsed.data;
  if (visit.user_id !== auth.user.id) return response(403, "CAPABILITY_MISMATCH", "This visit belongs to a different account.");

  const capabilities = new Set((capabilityRows ?? []).map((row) => row.capability_code));
  const allowed = capabilities.has("admin") || (visit.segment_type === "Retailer" ? capabilities.has("field_ret") : capabilities.has("field_dist"));
  if (!allowed) return response(403, "CAPABILITY_MISMATCH", "Your account is not permitted to confirm this visit segment.");

  const { data: lead, error: leadError } = await admin.from("leads").select("lead_id,segment_type").eq("lead_id", visit.lead_id).maybeSingle();
  if (leadError || !lead || lead.segment_type !== visit.segment_type) return response(400, "VISIT_VALIDATION_FAILED", "The selected business reference is invalid for this segment.");

  if (!capabilities.has("admin")) {
    if (!visit.attendance_id) return response(409, "ATTENDANCE_NOT_CONFIRMED", "Attendance is not yet confirmed. Retry synchronization.");
    const { data: attendance, error: attendanceError } = await admin.from("attendance")
      .select("attendance_id,user_id,date").eq("attendance_id", visit.attendance_id).maybeSingle();
    if (attendanceError || !attendance || attendance.user_id !== auth.user.id || attendance.date !== visit.visit_date) {
      return response(409, "ATTENDANCE_NOT_CONFIRMED", "Attendance is not yet confirmed. Retry synchronization.");
    }
  }

  const select = "visit_id,user_id,lead_id,segment_type,selfie_storage_path";
  const insertResult = await admin.from("field_visits").insert(remotePayload(visit)).select(select).maybeSingle();
  let confirmed = insertResult.data;
  const insertError = insertResult.error;
  let alreadyConfirmed = false;
  if (insertError?.code === "23505") {
    alreadyConfirmed = true;
    const existing = await admin.from("field_visits").select(select).eq("visit_id", visit.visit_id).maybeSingle();
    if (existing.error) return response(500, "VISIT_CONFIRMATION_FAILED", "The exact visit could not be confirmed.");
    confirmed = existing.data;
  } else if (insertError) {
    console.error("Field visit insert failed", { code: insertError.code ?? "UNKNOWN" });
    return response(500, "VISIT_INSERT_FAILED", "The visit was retained locally and will retry.");
  }
  if (!confirmed || confirmed.visit_id !== visit.visit_id) return response(500, "VISIT_CONFIRMATION_FAILED", "The exact visit could not be confirmed.");
  if (confirmed.user_id !== auth.user.id || confirmed.lead_id !== visit.lead_id || confirmed.segment_type !== visit.segment_type) {
    return response(409, "VISIT_CONFIRMATION_FAILED", "The visit ID is already owned by incompatible visit data.");
  }

  const selfie = form.get("selfie");
  if (!(selfie instanceof Blob) || selfie.size === 0) {
    const evidenceConfirmed = Boolean(confirmed.selfie_storage_path);
    return Response.json({
      ok: true,
      code: evidenceConfirmed ? "VISIT_CONFIRMED" : "VISIT_CONFIRMED_EVIDENCE_PENDING",
      message: evidenceConfirmed ? "Visit confirmed successfully." : "Visit confirmed. Selfie evidence will retry automatically.",
      visit_id: visit.visit_id,
      already_confirmed: alreadyConfirmed,
      evidence_confirmed: evidenceConfirmed,
      ...(evidenceConfirmed ? { selfie_storage_path: confirmed.selfie_storage_path } : {}),
    });
  }
  if (selfie.size > MAX_EVIDENCE_BYTES || !selfie.type.startsWith("image/")) {
    return Response.json({ ok: true, code: "VISIT_CONFIRMED_EVIDENCE_PENDING", message: "Visit confirmed. Selfie evidence will retry automatically.", visit_id: visit.visit_id, already_confirmed: alreadyConfirmed, evidence_confirmed: false });
  }

  const evidencePath = generateEvidencePath(auth.user.id, visit.visit_date, visit.visit_id);
  const upload = await admin.storage.from("visits-evidence").upload(evidencePath, selfie, { contentType: selfie.type || "image/jpeg", upsert: false });
  if (upload.error) {
    const duplicate = Number(upload.error.statusCode) === 409 || /already exists|duplicate/i.test(upload.error.message);
    if (!duplicate || !(await equalEvidence(admin, evidencePath, selfie))) {
      console.error("Field visit evidence upload failed", { code: upload.error.statusCode ?? "UNKNOWN" });
      return Response.json({ ok: true, code: "VISIT_CONFIRMED_EVIDENCE_PENDING", message: "Visit confirmed. Selfie evidence will retry automatically.", visit_id: visit.visit_id, already_confirmed: alreadyConfirmed, evidence_confirmed: false });
    }
  }

  const { data: updated, error: updateError } = await admin.from("field_visits")
    .update({ selfie_storage_path: evidencePath, updated_at: new Date().toISOString() })
    .eq("visit_id", visit.visit_id).eq("user_id", auth.user.id).select("visit_id,selfie_storage_path").maybeSingle();
  if (updateError || updated?.visit_id !== visit.visit_id || updated.selfie_storage_path !== evidencePath) {
    console.error("Field visit evidence link failed", { code: updateError?.code ?? "CONFIRMATION_MISSING" });
    return Response.json({ ok: true, code: "VISIT_CONFIRMED_EVIDENCE_PENDING", message: "Visit confirmed. Selfie evidence will retry automatically.", visit_id: visit.visit_id, already_confirmed: alreadyConfirmed, evidence_confirmed: false });
  }
  return Response.json({ ok: true, code: "VISIT_CONFIRMED", message: "Visit confirmed successfully.", visit_id: visit.visit_id, already_confirmed: alreadyConfirmed, evidence_confirmed: true, selfie_storage_path: evidencePath });
}
