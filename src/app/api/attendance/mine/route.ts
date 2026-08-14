import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getCurrentISTDate, isValidISTDateKey } from "@/lib/dateTime";
import { attendanceModeForCapabilities } from "@/lib/attendance/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COLUMNS = "attendance_id,user_id,date,clock_in,clock_out,latitude,longitude,selfie_captured,selfie_storage_path,selfie_uploaded_at,selfie_purged_at,selfie_purge_state";

function serviceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }) : null;
}

function fail(status: number, code: string) {
  return Response.json({ ok: false, code }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const service = serviceClient();
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!service || !token) return fail(401, "AUTH_REQUIRED");
  const auth = await service.auth.getUser(token);
  if (auth.error || !auth.data.user) return fail(401, "AUTH_REQUIRED");
  const requestedDate = new URL(request.url).searchParams.get("date") ?? "";
  if (!isValidISTDateKey(requestedDate) || requestedDate !== getCurrentISTDate()) return fail(400, "ATTENDANCE_DATE_INVALID");
  const [{ data: profile }, { data: capabilityRows }] = await Promise.all([
    service.from("users").select("user_id,is_active").eq("user_id", auth.data.user.id).maybeSingle(),
    service.from("user_capabilities").select("capability_code").eq("user_id", auth.data.user.id),
  ]);
  if (!(profile?.is_active === true || profile?.is_active === 1)) return fail(403, "ACCOUNT_INACTIVE");
  const capabilities = (capabilityRows ?? []).map((row) => row.capability_code);
  const mode = attendanceModeForCapabilities(capabilities);
  if (mode === "admin_read_only" || mode === "not_eligible") return fail(403, "ATTENDANCE_NOT_ELIGIBLE");
  const result = await service.from("attendance").select(COLUMNS).eq("user_id", auth.data.user.id).eq("date", requestedDate).order("clock_in").limit(2);
  if (result.error) return fail(502, "ATTENDANCE_AUTHORITY_UNAVAILABLE");
  return Response.json({ ok: true, date: requestedDate, user_id: auth.data.user.id, mode, attendance: result.data ?? [] }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
