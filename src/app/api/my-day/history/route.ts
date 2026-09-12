import { addISTDateDays, getISTDateKey } from "@/lib/dateTime";
import { backendUnavailableResponse, createServerServiceClient } from "@/lib/serverBackendEnvironment";
import { boundedReportJson, createReportResource } from "@/lib/analytics/reportResource";
import { buildHistoryReport, HistoryRequestError, parseHistoryScope } from "@/lib/teamKpi/history";
import { readRetainedHistory } from "@/lib/teamKpi/retainedHistoryServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const resource = createReportResource(request.signal);
  try {
    resource.check();
    const backend = createServerServiceClient({ fetch: resource.fetch });
    if (!backend.ok) return backendUnavailableResponse();
    const authorization = request.headers.get("authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) return Response.json({ message: "Sign in again." }, { status: 401 });
    const { data, error } = await backend.client.auth.getUser(authorization.slice(7).trim());
    resource.check();
    if (error || !data.user) return Response.json({ message: "Sign in again." }, { status: 401 });
    const profile = await resource.read(backend.client.from("users").select("user_id,name,is_active").eq("user_id", data.user.id).limit(2), true);
    if (profile.error || profile.data?.length !== 1 || profile.data[0].user_id !== data.user.id || profile.data[0].is_active !== true) return Response.json({ message: "An active account is required." }, { status: 403 });
    const params = new URL(request.url).searchParams, generatedAt = new Date().toISOString();
    if ([...params.keys()].some(key => !["from", "to", "metric"].includes(key)) || params.get("metric") === "mappings_completed") throw new HistoryRequestError("SELF_SCOPE_REQUIRED", "My Day history supports only your own Calls or Visits.");
    if (!params.size) {
      params.set("from", addISTDateDays(getISTDateKey(generatedAt), -7));
      params.set("to", addISTDateDays(getISTDateKey(generatedAt), -1));
    }
    const scope = parseHistoryScope(params, generatedAt);
    if (!scope) throw new HistoryRequestError("INVALID_HISTORY_RANGE", "Choose a history range.");
    const members = [{ user_id: data.user.id, name: profile.data[0].name || "Your account", role: "Your retained records" }];
    let source;
    try { source = await readRetainedHistory(backend.client, scope, [data.user.id], generatedAt, resource); }
    catch { resource.check(); }
    const report = buildHistoryReport({ scope, generatedAt, members, calls: source?.calls ?? [], events: source?.events ?? [], requests: resource.diagnostics.reader_requests,
      sourceError: source ? null : "Your selected source could not be exhausted. Narrow the range or retry; no partial totals are presented.", self: true });
    resource.check();
    return boundedReportJson({ ...report, diagnostics: resource.diagnostics });
  } catch (error) {
    return Response.json({ message: error instanceof HistoryRequestError ? error.message : "Own history unavailable. Retry a narrower range." }, { status: error instanceof HistoryRequestError ? error.status : 503, headers: { "Cache-Control": "no-store" } });
  } finally { resource.finish(); }
}
