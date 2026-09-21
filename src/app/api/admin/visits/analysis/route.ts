import { createServerServiceClient, backendUnavailableResponse } from "@/lib/serverBackendEnvironment";
import { boundedReportJson, createReportResource, ReportUnavailable } from "@/lib/analytics/reportResource";
import { parseVisitSummary, readVisitSummary } from "@/lib/fieldVisits/range";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const resource = createReportResource(request.signal);
  let scope;
  try {
    resource.check();
    const backend = createServerServiceClient({ fetch: resource.fetch });
    if (!backend.ok) return backendUnavailableResponse();
    const authorization = request.headers.get("authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) return Response.json({ code: "AUTH_REQUIRED" }, { status: 401 });
    const { data, error } = await backend.client.auth.getUser(authorization.slice(7).trim());
    resource.check();
    if (error || !data.user) return Response.json({ code: "AUTH_REQUIRED" }, { status: 401 });
    const [profile, caps] = await Promise.all([
      resource.read(backend.client.from("users").select("is_active").eq("user_id", data.user.id).limit(2), true),
      resource.read(backend.client.from("user_capabilities").select("capability_code").eq("user_id", data.user.id).eq("capability_code", "admin").limit(1), true),
    ]);
    if (profile.error || caps.error || profile.data?.length !== 1 || profile.data[0].is_active !== true || !caps.data?.some((cap) => cap.capability_code === "admin")) return Response.json({ code: "ADMIN_REQUIRED" }, { status: 403 });
    try { scope = parseVisitSummary(new URL(request.url).searchParams, new Date().toISOString()); }
    catch { return Response.json({ code: "INVALID_VISIT_SUMMARY_SCOPE" }, { status: 400 }); }
    const aggregate = await readVisitSummary(backend.client, scope, resource);
    resource.check();
    return boundedReportJson({
      kind: "visit-summary-v1", schema_version: 1, scope, generated_at: new Date().toISOString(),
      retained_source_read: "aggregated", historical_coverage: "uncertified",
      consistency: "single-statement-snapshot", metric_attribution: "visit_id / immutable user_id / canonical visit_date",
      ...aggregate,
      diagnostics: resource.diagnostics,
    });
  } catch (error) {
    return Response.json({ kind: "visit-summary-v1", schema_version: 1, scope: scope ?? null, generated_at: null,
      retained_source_read: "unavailable", historical_coverage: "uncertified", retained_visit_count: null,
      code: error instanceof ReportUnavailable ? error.message : "VISIT_SUMMARY_UNAVAILABLE", diagnostics: resource.diagnostics,
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  } finally { resource.finish(); }
}
