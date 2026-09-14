import { boundedReportJson, createReportResource } from "@/lib/analytics/reportResource";
import { backendUnavailableResponse, createServerServiceClient } from "@/lib/serverBackendEnvironment";
import { getCurrentISTDate } from "@/lib/dateTime";
import { visitUuid } from "@/lib/fieldVisits/range";
import { HistoryRequestError } from "@/lib/teamKpi/history";
import { loadManagementReview } from "@/lib/teamKpi/reviewServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const resource = createReportResource(request.signal);
  try {
    resource.check();
    const backend = createServerServiceClient({ fetch: resource.fetch });
    if (!backend.ok) return backendUnavailableResponse();
    const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
    if (!token) return Response.json({ message: "Sign in again." }, { status: 401 });
    const auth = await backend.client.auth.getUser(token); resource.check();
    if (auth.error || !auth.data.user) return Response.json({ message: "Sign in again." }, { status: 401 });
    const id = auth.data.user.id;
    const profile = await resource.read(backend.client.from("users").select("user_id,is_active").eq("user_id", id).limit(2), true);
    if (profile.error || profile.data?.length !== 1 || profile.data[0].user_id !== id || profile.data[0].is_active !== true) return Response.json({ message: "An active account is required." }, { status: 403 });
    const admin = await resource.read(backend.client.from("user_capabilities").select("capability_code").eq("user_id", id).eq("capability_code", "admin").limit(1), true);
    if (admin.error) return Response.json({ message: "Authorization unavailable." }, { status: 503 });
    if (admin.data?.[0]?.capability_code !== "admin") return Response.json({ message: "Admin access required." }, { status: 403 });
    const params = new URL(request.url).searchParams, employee = params.get("employee") || null;
    if ([...params.keys()].some(key => key !== "employee") || params.getAll("employee").length > 1 || (employee && !visitUuid.safeParse(employee).success)) return Response.json({ message: "Choose one valid current employee." }, { status: 400 });
    const report = await loadManagementReview(backend.client, resource, employee?.toLowerCase() ?? null, getCurrentISTDate(), new Date().toISOString());
    resource.check();
    return boundedReportJson({ ...report, diagnostics: resource.diagnostics });
  } catch (error) { return Response.json({ message: error instanceof HistoryRequestError ? error.message : "Current workload unavailable. Retry or select an employee." }, { status: error instanceof HistoryRequestError ? error.status : 503 }); }
  finally { resource.finish(); }
}
