import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { attendanceEvidencePath, SELFIE_BUCKET } from "@/lib/fieldVisits/retention";
import { getCurrentISTDate } from "@/lib/dateTime";

export const runtime = "nodejs";
const MAX_EVIDENCE_BYTES = 8 * 1024 * 1024;
const schema = z.object({
  attendance_id: z.string().uuid(), user_id: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  clock_in: z.string().datetime({ offset: true }), clock_out: z.string().datetime({ offset: true }).nullable().optional(),
  selfie_url: z.null().optional(), latitude: z.number().finite().min(-90).max(90).nullable().optional(),
  longitude: z.number().finite().min(-180).max(180).nullable().optional(),
}).strict();

function adminClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) : null;
}
function fail(status: number, code: string) { return Response.json({ ok: false, code }, { status, headers: { "Cache-Control": "no-store" } }); }
async function sameObject(client: SupabaseClient, path: string, incoming: Blob): Promise<boolean> {
  const stored = await client.storage.from(SELFIE_BUCKET).download(path);
  if (stored.error || !stored.data || stored.data.size !== incoming.size) return false;
  const [a, b] = await Promise.all([crypto.subtle.digest("SHA-256", await stored.data.arrayBuffer()), crypto.subtle.digest("SHA-256", await incoming.arrayBuffer())]);
  return Buffer.from(a).equals(Buffer.from(b));
}

export async function POST(request: Request) {
  const client = adminClient();
  const authHeader = request.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!client || !token) return fail(401, "AUTH_REQUIRED");
  const auth = await client.auth.getUser(token);
  if (auth.error || !auth.data.user) return fail(401, "AUTH_REQUIRED");
  let form: FormData;
  try { form = await request.formData(); } catch { return fail(400, "ATTENDANCE_REQUEST_INVALID"); }
  const raw = form.get("attendance");
  if (typeof raw !== "string") return fail(400, "ATTENDANCE_REQUEST_INVALID");
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return fail(400, "ATTENDANCE_REQUEST_INVALID"); }
  const parsed = schema.safeParse(json);
  if (!parsed.success || parsed.data.user_id !== auth.data.user.id || parsed.data.date !== getCurrentISTDate()) return fail(400, "ATTENDANCE_VALIDATION_FAILED");
  const attendance = parsed.data;
  const selfie = form.get("selfie");
  const [{ data: account }, { data: capabilities }, { data: existing, error: existingError }] = await Promise.all([
    client.from("users").select("user_id,is_active").eq("user_id", auth.data.user.id).maybeSingle(),
    client.from("user_capabilities").select("capability_code").eq("user_id", auth.data.user.id),
    client.from("attendance").select("attendance_id,user_id,date,clock_in,clock_out,selfie_storage_path,selfie_uploaded_at,selfie_purged_at,selfie_captured").eq("attendance_id", attendance.attendance_id).maybeSingle(),
  ]);
  if (!(account?.is_active === true || account?.is_active === 1)) return fail(403, "ACCOUNT_INACTIVE");
  const fieldStaff = (capabilities ?? []).some((row) => row.capability_code === "field_ret" || row.capability_code === "field_dist");
  if (fieldStaff && (!(selfie instanceof Blob) || selfie.size === 0 || selfie.size > MAX_EVIDENCE_BYTES || !["image/jpeg", "image/webp"].includes(selfie.type))) return fail(400, "ATTENDANCE_EVIDENCE_REQUIRED");
  if (existingError) return fail(500, "ATTENDANCE_LOOKUP_FAILED");
  if (existing && existing.user_id !== auth.data.user.id) return fail(409, "ATTENDANCE_ID_COLLISION");
  if (!fieldStaff) {
    const business = { ...attendance, selfie_url: null, selfie_captured: false };
    const confirmed = existing ? { data: existing, error: null } : await client.from("attendance").insert(business).select("attendance_id,user_id,date,clock_in,clock_out,selfie_storage_path,selfie_uploaded_at,selfie_purged_at,selfie_captured").maybeSingle();
    if (confirmed.error || confirmed.data?.attendance_id !== attendance.attendance_id) return fail(503, "ATTENDANCE_CONFIRMATION_FAILED");
    return Response.json({ ok: true, code: existing ? "ATTENDANCE_ALREADY_CONFIRMED" : "ATTENDANCE_CONFIRMED", attendance_id: attendance.attendance_id, attendance: confirmed.data }, { headers: { "Cache-Control": "no-store" } });
  }
  const evidence = selfie as Blob;
  const path = attendanceEvidencePath(attendance.user_id, attendance.date, attendance.attendance_id);
  if (existing?.selfie_storage_path === path && existing.selfie_uploaded_at) {
    return Response.json({ ok: true, code: "ATTENDANCE_ALREADY_CONFIRMED", attendance_id: attendance.attendance_id, attendance: existing }, { headers: { "Cache-Control": "no-store" } });
  }
  const uploaded = await client.storage.from(SELFIE_BUCKET).upload(path, evidence, { contentType: "image/jpeg", upsert: false });
  if (uploaded.error && !(await sameObject(client, path, evidence))) return fail(503, "ATTENDANCE_EVIDENCE_UPLOAD_FAILED");
  const uploadedAt = new Date().toISOString();
  const business = { ...attendance, selfie_url: null, selfie_captured: true, selfie_storage_path: path, selfie_uploaded_at: uploadedAt, selfie_purged_at: null, selfie_purge_state: "available" };
  const confirmed = existing
    ? await client.from("attendance").update({ selfie_captured: true, selfie_storage_path: path, selfie_uploaded_at: uploadedAt, selfie_purged_at: null, selfie_purge_state: "available" }).eq("attendance_id", attendance.attendance_id).eq("user_id", attendance.user_id).select("attendance_id,user_id,date,clock_in,clock_out,selfie_storage_path,selfie_uploaded_at,selfie_purged_at,selfie_captured").maybeSingle()
    : await client.from("attendance").insert(business).select("attendance_id,user_id,date,clock_in,clock_out,selfie_storage_path,selfie_uploaded_at,selfie_purged_at,selfie_captured").maybeSingle();
  if (confirmed.error || confirmed.data?.attendance_id !== attendance.attendance_id) return fail(503, "ATTENDANCE_CONFIRMATION_FAILED");
  return Response.json({ ok: true, code: existing ? "ATTENDANCE_ALREADY_CONFIRMED" : "ATTENDANCE_CONFIRMED", attendance_id: attendance.attendance_id, attendance: confirmed.data }, { headers: { "Cache-Control": "no-store" } });
}
