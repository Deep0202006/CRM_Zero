import { createClient } from "@supabase/supabase-js";
import { listErpSystems } from "@/lib/erp/server";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!url || !anon || !serviceKey || !token) return Response.json({ code: "AUTH_REQUIRED" }, { status: 401 });
  const auth = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${token}` } } });
  const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: identity } = await auth.auth.getUser(token); if (!identity.user) return Response.json({ code: "AUTH_REQUIRED" }, { status: 401 });
  const [{ data: account }, { data: capabilities }] = await Promise.all([service.from("users").select("is_active").eq("user_id", identity.user.id).maybeSingle(), service.from("user_capabilities").select("capability_code").eq("user_id", identity.user.id)]);
  const codes = new Set((capabilities ?? []).map((row) => row.capability_code));
  if (!(account?.is_active === true || account?.is_active === 1) || !["field_ret", "field_dist", "admin"].some((code) => codes.has(code))) return Response.json({ code: "CAPABILITY_MISMATCH" }, { status: 403 });
  const rows = await listErpSystems(service); return Response.json({ rows: rows.map(({ erp_id, erp_name }) => ({ erp_id, erp_name })) }, { headers: { "Cache-Control": "no-store" } });
}
