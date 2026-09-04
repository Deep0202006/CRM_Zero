import { listErpSystems } from "@/lib/erp/server";
import { createServerAnonClient, createServerServiceClient } from "@/lib/serverBackendEnvironment";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ code: "AUTH_REQUIRED" }, { status: 401 });
  const authResult = createServerAnonClient(token), serviceResult = createServerServiceClient();
  if (!authResult.ok || !serviceResult.ok) return Response.json({ code: "BACKEND_UNAVAILABLE" }, { status: 503 });
  const auth = authResult.client, service = serviceResult.client;
  const { data: identity } = await auth.auth.getUser(token); if (!identity.user) return Response.json({ code: "AUTH_REQUIRED" }, { status: 401 });
  const [{ data: account }, { data: capabilities }] = await Promise.all([service.from("users").select("is_active").eq("user_id", identity.user.id).maybeSingle(), service.from("user_capabilities").select("capability_code").eq("user_id", identity.user.id)]);
  const codes = new Set((capabilities ?? []).map((row) => row.capability_code));
  if (!(account?.is_active === true || account?.is_active === 1) || !["field_ret", "field_dist", "admin"].some((code) => codes.has(code))) return Response.json({ code: "CAPABILITY_MISMATCH" }, { status: 403 });
  const rows = await listErpSystems(service); return Response.json({ rows: rows.map(({ erp_id, erp_name }) => ({ erp_id, erp_name })) }, { headers: { "Cache-Control": "no-store" } });
}
