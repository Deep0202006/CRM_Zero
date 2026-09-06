import { backendUnavailableResponse, createServerServiceClient } from "@/lib/serverBackendEnvironment";
export const runtime = "nodejs"; export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const serviceResult = createServerServiceClient();
  if (!serviceResult.ok) return backendUnavailableResponse();
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return Response.json({ code: "AUTH_REQUIRED" }, { status: 401 });
  const admin = serviceResult.client;
  const { data: auth } = await admin.auth.getUser(token); if (!auth.user) return Response.json({ code: "AUTH_REQUIRED" }, { status: 401 });
  const [{ data: user }, { data: caps }] = await Promise.all([admin.from("users").select("is_active").eq("user_id", auth.user.id).maybeSingle(), admin.from("user_capabilities").select("capability_code").eq("user_id", auth.user.id)]);
  if (!(user?.is_active === true || user?.is_active === 1) || !(caps ?? []).some((row) => row.capability_code === "admin")) return Response.json({ code: "ADMIN_REQUIRED" }, { status: 403 });
  const { data, error } = await admin.rpc("field_visit_erp_intelligence_v2");
  if (error) return Response.json({ code: "ERP_ANALYTICS_UNAVAILABLE" }, { status: 503 });
  return Response.json({ segments: data }, { headers: { "Cache-Control": "no-store" } });
}
