import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { attendanceEvidencePath, SELFIE_BUCKET } from "@/lib/fieldVisits/retention";
import { getCurrentISTDate } from "@/lib/dateTime";
import { ATTENDANCE_QUEUE_SCHEMA_VERSION, normalizeAttendanceConfirmationPayload, parseAttendanceQueueSchemaVersion } from "@/lib/syncPayload";
import { attendanceModeForCapabilities } from "@/lib/attendance/roles";

export const runtime = "nodejs";
const MAX_EVIDENCE_BYTES = 8 * 1024 * 1024;
const schema = z.object({
  attendance_id: z.string().uuid(), user_id: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  clock_in: z.string().datetime({ offset: true }), clock_out: z.string().datetime({ offset: true }).nullable().optional(),
  selfie_url: z.null().optional(), latitude: z.number().finite().min(-90).max(90).nullable().optional(),
  longitude: z.number().finite().min(-180).max(180).nullable().optional(),
}).strict();

type FailureTelemetry = {
  request_id: string;
  operation_id: string | null;
  client_contract: string;
  queue_schema_version: string;
  stage: string;
  reason: string;
};

function adminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) : null;
}
function safeContractMarker(value: string | null): string {
  return value === "attendance-queue-v2" ? value : "unidentified";
}

function safeOperationId(value: unknown): string | null {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

function fail(status: number, code: string, telemetry: FailureTelemetry) {
  console.warn("ATTENDANCE_CONFIRM_FAILURE", telemetry);
  return Response.json(
    { ok: false, code, reason: telemetry.reason, request_id: telemetry.request_id },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
function duplicateKey(error: { code?: string; message?: string } | null | undefined) { return Boolean(error && (error.code === "23505" || /duplicate key/i.test(error.message ?? ""))); }
function success(code: "ATTENDANCE_CONFIRMED" | "ATTENDANCE_ALREADY_CONFIRMED", operationId: string, attendance: Record<string, unknown>) {
  return Response.json({ ok: true, code, operation_id: operationId, attendance_id: attendance.attendance_id, attendance }, { headers: { "Cache-Control": "no-store" } });
}
async function sameObject(client: SupabaseClient, path: string, incoming: Blob): Promise<boolean> {
  const stored = await client.storage.from(SELFIE_BUCKET).download(path);
  if (stored.error || !stored.data || stored.data.size !== incoming.size) return false;
  const [a, b] = await Promise.all([crypto.subtle.digest("SHA-256", await stored.data.arrayBuffer()), crypto.subtle.digest("SHA-256", await incoming.arrayBuffer())]);
  return Buffer.from(a).equals(Buffer.from(b));
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  const clientContract = safeContractMarker(request.headers.get("x-zerodata-attendance-contract"));
  const baseTelemetry = {
    request_id: requestId,
    operation_id: null,
    client_contract: clientContract,
    queue_schema_version: "missing",
  };
  const client = adminClient();
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!client || !token) return fail(401, "AUTH_REQUIRED", { ...baseTelemetry, stage: "authentication", reason: "AUTH_REQUIRED" });
  const auth = await client.auth.getUser(token);
  if (auth.error || !auth.data.user) return fail(401, "AUTH_REQUIRED", { ...baseTelemetry, stage: "authentication", reason: "AUTH_REQUIRED" });
  let form: FormData;
  try { form = await request.formData(); } catch { return fail(400, "ATTENDANCE_REQUEST_INVALID", { ...baseTelemetry, stage: "multipart", reason: "FORM_DATA_INVALID" }); }
  const raw = form.get("attendance");
  if (typeof raw !== "string") return fail(400, "ATTENDANCE_REQUEST_INVALID", { ...baseTelemetry, stage: "multipart", reason: "ATTENDANCE_PART_MISSING" });
  const rawQueueSchemaVersion = form.get("queue_schema_version");
  const queueVersionMarker = typeof rawQueueSchemaVersion === "string" && /^\d{1,4}$/.test(rawQueueSchemaVersion) ? rawQueueSchemaVersion : "missing-or-invalid";
  const telemetryWithQueue = { ...baseTelemetry, queue_schema_version: queueVersionMarker };
  const queueSchemaVersion = parseAttendanceQueueSchemaVersion(form.get("queue_schema_version"));
  if (queueSchemaVersion === null) return fail(400, "ATTENDANCE_QUEUE_SCHEMA_UNSUPPORTED", { ...telemetryWithQueue, stage: "queue_contract", reason: "QUEUE_SCHEMA_UNSUPPORTED" });
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return fail(400, "ATTENDANCE_REQUEST_INVALID", { ...telemetryWithQueue, stage: "json", reason: "ATTENDANCE_JSON_INVALID" }); }
  const operationId = json && typeof json === "object" && !Array.isArray(json)
    ? safeOperationId((json as Record<string, unknown>).attendance_id)
    : null;
  const telemetry = { ...telemetryWithQueue, operation_id: operationId };
  const compatiblePayload = json && typeof json === "object" && !Array.isArray(json)
    ? normalizeAttendanceConfirmationPayload(json)
    : { data: json };
  const parsed = schema.safeParse(compatiblePayload.data);
  if (!parsed.success) {
    const issueTypes = [...new Set(parsed.error.issues.map((issue) => issue.code))].sort().join(",");
    return fail(400, "ATTENDANCE_VALIDATION_FAILED", { ...telemetry, stage: "schema", reason: `SCHEMA_${issueTypes || "INVALID"}` });
  }
  if (parsed.data.user_id !== auth.data.user.id) return fail(400, "ATTENDANCE_VALIDATION_FAILED", { ...telemetry, stage: "identity", reason: "AUTH_USER_MISMATCH" });
  if (parsed.data.date !== getCurrentISTDate()) return fail(400, "ATTENDANCE_VALIDATION_FAILED", { ...telemetry, stage: "business_date", reason: "IST_DATE_MISMATCH" });
  const attendance = parsed.data;
  const selfie = form.get("selfie");
  const [{ data: account }, { data: capabilities }, { data: existingById, error: existingIdError }, { data: existingByDate, error: existingDateError }] = await Promise.all([
    client.from("users").select("user_id,is_active").eq("user_id", auth.data.user.id).maybeSingle(),
    client.from("user_capabilities").select("capability_code").eq("user_id", auth.data.user.id),
    client.from("attendance").select("attendance_id,user_id,date,clock_in,clock_out,selfie_storage_path,selfie_uploaded_at,selfie_purged_at,selfie_captured").eq("attendance_id", attendance.attendance_id).maybeSingle(),
    client.from("attendance").select("attendance_id,user_id,date,clock_in,clock_out,selfie_storage_path,selfie_uploaded_at,selfie_purged_at,selfie_captured").eq("user_id", auth.data.user.id).eq("date", attendance.date).maybeSingle(),
  ]);
  if (!(account?.is_active === true || account?.is_active === 1)) return fail(403, "ACCOUNT_INACTIVE", { ...telemetry, stage: "account", reason: "ACCOUNT_INACTIVE" });
  const attendanceMode = attendanceModeForCapabilities((capabilities ?? []).map((row) => row.capability_code));
  if (attendanceMode === "admin_read_only" || attendanceMode === "not_eligible") return fail(403, "ATTENDANCE_NOT_ELIGIBLE", { ...telemetry, stage: "authorization", reason: "ATTENDANCE_NOT_ELIGIBLE" });
  const fieldStaff = attendanceMode === "field_selfie";
  if (fieldStaff && (!(selfie instanceof Blob) || selfie.size === 0 || selfie.size > MAX_EVIDENCE_BYTES || !["image/jpeg", "image/webp"].includes(selfie.type))) return fail(400, "ATTENDANCE_EVIDENCE_REQUIRED", { ...telemetry, stage: "evidence", reason: "SELFIE_MISSING_INVALID_OR_TOO_LARGE" });
  if (fieldStaff && queueSchemaVersion === ATTENDANCE_QUEUE_SCHEMA_VERSION && (attendance.latitude == null || attendance.longitude == null)) return fail(400, "ATTENDANCE_LOCATION_REQUIRED", { ...telemetry, stage: "location", reason: "LOCATION_REQUIRED" });
  if (existingIdError || existingDateError) return fail(500, "ATTENDANCE_LOOKUP_FAILED", { ...telemetry, stage: "authority_lookup", reason: "ATTENDANCE_LOOKUP_FAILED" });
  if (existingById && existingById.user_id !== auth.data.user.id) return fail(409, "ATTENDANCE_ID_COLLISION", { ...telemetry, stage: "idempotency", reason: "ATTENDANCE_ID_COLLISION" });
  const existing = existingById ?? existingByDate;
  if (!fieldStaff) {
    const business = { ...attendance, selfie_url: null, selfie_captured: false };
    const confirmed = existing ? { data: existing, error: null } : await client.from("attendance").insert(business).select("attendance_id,user_id,date,clock_in,clock_out,selfie_storage_path,selfie_uploaded_at,selfie_purged_at,selfie_captured").maybeSingle();
    if (duplicateKey(confirmed.error)) {
      const raced = await client.from("attendance").select("attendance_id,user_id,date,clock_in,clock_out,selfie_storage_path,selfie_uploaded_at,selfie_purged_at,selfie_captured").eq("user_id", attendance.user_id).eq("date", attendance.date).maybeSingle();
      if (!raced.error && raced.data) return success("ATTENDANCE_ALREADY_CONFIRMED", attendance.attendance_id, raced.data);
    }
    const confirmedData = confirmed.data;
    if (confirmed.error || !confirmedData || confirmedData.attendance_id !== (existing?.attendance_id ?? attendance.attendance_id)) return fail(503, "ATTENDANCE_CONFIRMATION_FAILED", { ...telemetry, stage: "authority_write", reason: "ATTENDANCE_CONFIRMATION_FAILED" });
    return success(existing ? "ATTENDANCE_ALREADY_CONFIRMED" : "ATTENDANCE_CONFIRMED", attendance.attendance_id, confirmedData);
  }
  const evidence = selfie as Blob;
  const path = attendanceEvidencePath(attendance.user_id, attendance.date, existing?.attendance_id ?? attendance.attendance_id);
  if (existing?.selfie_storage_path === path && existing.selfie_uploaded_at) {
    return Response.json({ ok: true, code: "ATTENDANCE_ALREADY_CONFIRMED", operation_id: attendance.attendance_id, attendance_id: existing.attendance_id, attendance: existing }, { headers: { "Cache-Control": "no-store" } });
  }
  const uploaded = await client.storage.from(SELFIE_BUCKET).upload(path, evidence, { contentType: evidence.type, upsert: false });
  if (uploaded.error && !(await sameObject(client, path, evidence))) return fail(503, "ATTENDANCE_EVIDENCE_UPLOAD_FAILED", { ...telemetry, stage: "evidence_upload", reason: "ATTENDANCE_EVIDENCE_UPLOAD_FAILED" });
  const uploadedAt = new Date().toISOString();
  const business = { ...attendance, selfie_url: null, selfie_captured: true, selfie_storage_path: path, selfie_uploaded_at: uploadedAt, selfie_purged_at: null, selfie_purge_state: "available" };
  const confirmed = existing
    ? await client.from("attendance").update({ selfie_captured: true, selfie_storage_path: path, selfie_uploaded_at: uploadedAt, selfie_purged_at: null, selfie_purge_state: "available" }).eq("attendance_id", existing.attendance_id).eq("user_id", attendance.user_id).select("attendance_id,user_id,date,clock_in,clock_out,selfie_storage_path,selfie_uploaded_at,selfie_purged_at,selfie_captured").maybeSingle()
    : await client.from("attendance").insert(business).select("attendance_id,user_id,date,clock_in,clock_out,selfie_storage_path,selfie_uploaded_at,selfie_purged_at,selfie_captured").maybeSingle();
  if (duplicateKey(confirmed.error)) {
    const raced = await client.from("attendance").select("attendance_id,user_id,date,clock_in,clock_out,selfie_storage_path,selfie_uploaded_at,selfie_purged_at,selfie_captured").eq("user_id", attendance.user_id).eq("date", attendance.date).maybeSingle();
    if (!raced.error && raced.data) {
      const canonicalPath = attendanceEvidencePath(attendance.user_id, attendance.date, raced.data.attendance_id);
      if (path !== canonicalPath) {
        const cleanup = await client.storage.from(SELFIE_BUCKET).remove([path]);
        if (cleanup.error) console.warn("Attendance duplicate evidence cleanup failed", { code: cleanup.error.name ?? "STORAGE_REMOVE_FAILED" });
      }
      return success("ATTENDANCE_ALREADY_CONFIRMED", attendance.attendance_id, raced.data);
    }
  }
  const confirmedData = confirmed.data;
  if (confirmed.error || !confirmedData || confirmedData.attendance_id !== (existing?.attendance_id ?? attendance.attendance_id)) return fail(503, "ATTENDANCE_CONFIRMATION_FAILED", { ...telemetry, stage: "authority_write", reason: "ATTENDANCE_CONFIRMATION_FAILED" });
  return success(existing ? "ATTENDANCE_ALREADY_CONFIRMED" : "ATTENDANCE_CONFIRMED", attendance.attendance_id, confirmedData);
}
