import { createClient } from "@supabase/supabase-js";
import { getCurrentISTDate, getISTBusinessDayBounds } from "@/lib/dateTime";

export const runtime = "nodejs"; export const dynamic = "force-dynamic";
const PAGE_SIZE = 50; const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function json(status: number, body: Record<string, unknown>) { return Response.json(body, { status, headers: { "Cache-Control": "no-store" } }); }
function active(value: unknown) { return value === true || value === 1 || value === "1" || value === "true"; }
export async function GET(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const authorization = request.headers.get("authorization") ?? ""; const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!url || !anon || !key || !token) return json(401, { code: "AUTH_REQUIRED" });
  const authClient = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const service = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: auth, error: authError } = await authClient.auth.getUser(token);
  if (authError || !auth.user) return json(401, { code: "AUTH_REQUIRED" });
  const { data: account } = await service.from("users").select("user_id,is_active").eq("user_id", auth.user.id).maybeSingle();
  if (!account || !active(account.is_active)) return json(403, { code: "ACCOUNT_INACTIVE" });
  const requestUrl = new URL(request.url); const page = Math.max(1, Number.parseInt(requestUrl.searchParams.get("page") ?? "1", 10) || 1);
  const requestedIds = [...new Set((requestUrl.searchParams.get("ids") ?? "").split(",").filter((id) => UUID.test(id)))].slice(0, 100);
  if (requestUrl.searchParams.get("reconcile_only") === "true") {
    const reconciliation = requestedIds.length ? await service.from("field_visits").select("visit_id").eq("user_id", auth.user.id).in("visit_id", requestedIds) : { data: [], error: null };
    if (reconciliation.error) return json(502, { code: "FIELD_VISITS_READ_FAILED" });
    return json(200, { confirmed_requested_visit_ids: (reconciliation.data ?? []).map((row) => row.visit_id) });
  }
  const columns = "visit_id,lead_id,user_id,visit_date,check_in_time,check_in_lat,check_in_lng,address,pincode,check_in_photo_url,visit_outcome,visit_notes,created_at,updated_at,attendance_id,person_met,segment_type,follow_up_date,location_accuracy_m,location_captured_at,location_acquisition_mode,location_quality,selfie_captured_at,selfie_capture_method,selfie_storage_path,selfie_uploaded_at,selfie_purged_at,erp_id,erp_usage_state,erp_systems(erp_name)";
  const today = getCurrentISTDate(); const bounds = getISTBusinessDayBounds(today);
  const pageQuery = service.from("field_visits").select(columns, { count: "exact" }).eq("user_id", auth.user.id).order("created_at", { ascending: false }).order("visit_id", { ascending: false }).range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  const reconciliationQuery = requestedIds.length ? service.from("field_visits").select("visit_id").eq("user_id", auth.user.id).in("visit_id", requestedIds) : Promise.resolve({ data: [], error: null });
  const [pageResult, todayResult, reconciliationResult] = await Promise.all([
    pageQuery,
    service.from("field_visits").select("visit_id", { count: "exact", head: true }).eq("user_id", auth.user.id).or(`visit_date.eq.${today},and(check_in_time.gte.${bounds.startsAt},check_in_time.lt.${bounds.endsAt})`),
    reconciliationQuery,
  ]);
  if (pageResult.error || todayResult.error || reconciliationResult.error) return json(502, { code: "FIELD_VISITS_READ_FAILED" });
  const visits = (pageResult.data ?? []).map((row: Record<string, unknown>) => ({ ...row, erp_name: (row.erp_systems as { erp_name?: string } | null)?.erp_name ?? null }));
  return json(200, { visits, page, page_size: PAGE_SIZE, total: pageResult.count ?? 0, visits_today: todayResult.count ?? 0, has_more: page * PAGE_SIZE < (pageResult.count ?? 0), confirmed_requested_visit_ids: (reconciliationResult.data ?? []).map((row) => row.visit_id) });
}
