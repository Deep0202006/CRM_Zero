import { backendUnavailableResponse, createServerServiceClient } from "@/lib/serverBackendEnvironment";
import { createReportResource, ReportUnavailable } from "@/lib/analytics/reportResource";
import { buildVisitExportWorkbook, parseVisitExport, readVisitExport, readVisitExportErp } from "@/lib/fieldVisits/export";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const resource = createReportResource(request.signal);
  try {
    resource.check();
    const backend = createServerServiceClient({ fetch: resource.fetch });
    if (!backend.ok) return backendUnavailableResponse();
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    if (!token) return Response.json({ error: "Authentication required." }, { status: 401 });
    const { data, error } = await backend.client.auth.getUser(token);
    resource.check();
    if (error || !data.user) return Response.json({ error: "Authentication required." }, { status: 401 });
    const [profile, caps] = await Promise.all([
      resource.read(backend.client.from("users").select("is_active").eq("user_id", data.user.id).limit(2), true),
      resource.read(backend.client.from("user_capabilities").select("capability_code").eq("user_id", data.user.id).eq("capability_code", "admin").limit(1), true),
    ]);
    if (profile.error || caps.error || profile.data?.length !== 1 || profile.data[0].is_active !== true || !caps.data?.some(cap => cap.capability_code === "admin")) return Response.json({ error: "Administrator access required." }, { status: 403 });
    let scope;
    try { scope = parseVisitExport(new URL(request.url).searchParams, new Date().toISOString()); }
    catch { return Response.json({ error: "Choose a valid date or range of up to 31 days before exporting." }, { status: 400 }); }
    const rows = await readVisitExport(backend.client, scope, resource);
    const erp = await readVisitExportErp(backend.client, resource);
    const buffer = buildVisitExportWorkbook(rows, erp, scope, resource);
    return new Response(new Uint8Array(buffer), { headers: {
      "Cache-Control": "no-store", "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="FieldVisitsExport_${scope.date || scope.date_from}.xlsx"`,
      "X-Export-Visit-Count": String(rows.length), "X-Export-Reader-Requests": String(resource.diagnostics.reader_requests),
    } });
  } catch (error) {
    return Response.json({ error: "Export unavailable or too large. Narrow the date range or filters and retry. No partial workbook was created.",
      code: error instanceof ReportUnavailable ? error.message : "VISIT_EXPORT_UNAVAILABLE",
    }, { status: 503, headers: { "Cache-Control": "no-store" } });
  } finally { resource.finish(); }
}
