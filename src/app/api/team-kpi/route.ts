import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentISTDate } from "@/lib/dateTime";
import { backendUnavailableResponse, createServerAnonClient, createServerServiceClient } from "@/lib/serverBackendEnvironment";
import { parseTeamKpiResponse } from "@/lib/teamKpi/contract";
import { loadTeamKpiServerReport, TeamKpiServerError } from "@/lib/teamKpi/serverReport";
import { HistoryRequestError, parseHistoryScope } from "@/lib/teamKpi/history";
import { loadTeamKpiHistory } from "@/lib/teamKpi/historyServer";
import { boundedReportJson, createReportResource, ReportUnavailable, type ReportResource } from "@/lib/analytics/reportResource";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ code, message }, { status, headers: { "Cache-Control": "no-store, max-age=0" } });
}
function active(value: unknown): boolean { return value === true || value === 1 || (typeof value === "string" && ["1", "true", "t"].includes(value.toLowerCase())); }
async function isAdmin(service: SupabaseClient, userId: string, resource?: ReportResource): Promise<boolean> {
  if (resource) {
    const [profile, capabilities] = await Promise.all([
      resource.read(service.from("users").select("user_id,is_active").eq("user_id", userId).limit(2), true),
      resource.read(service.from("user_capabilities").select("capability_code").eq("user_id", userId).eq("capability_code", "admin").limit(1), true),
    ]);
    return !profile.error && !capabilities.error && profile.data?.length === 1 && active(profile.data[0].is_active) && Boolean(capabilities.data?.some(row => row.capability_code === "admin"));
  }
  const [{ data: user }, { data: capabilities }] = await Promise.all([
    service.from("users").select("user_id,is_active").eq("user_id", userId).maybeSingle(),
    service.from("user_capabilities").select("capability_code").eq("user_id", userId),
  ]);
  return Boolean(user && active(user.is_active) && (capabilities ?? []).some((item: { capability_code: string }) => item.capability_code === "admin"));
}

export async function GET(request: NextRequest) {
  const resource = request.nextUrl.searchParams.size ? createReportResource(request.signal) : undefined;
  try {
  resource?.check();
  const serviceResult = createServerServiceClient(resource ? { fetch: resource.fetch } : undefined);
  const userResult = resource ? serviceResult : createServerAnonClient();
  if (!userResult.ok || !serviceResult.ok) return backendUnavailableResponse();
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return jsonError(401, "AUTHENTICATION_REQUIRED", "Sign in again to view Team KPI.");
  const token = authorization.slice(7).trim();
  const userClient = userResult.client;
  const service = serviceResult.client;
    const { data, error } = await userClient.auth.getUser(token);
    resource?.check();
    if (error || !data.user) return jsonError(401, "AUTHENTICATION_REQUIRED", "Your session has expired. Sign in again.");
    if (!(await isAdmin(service, data.user.id, resource))) return jsonError(403, "ADMIN_REQUIRED", "Administrator access is required for Team KPI.");
    const generatedAt = new Date().toISOString();
    const historyScope = parseHistoryScope(request.nextUrl.searchParams, generatedAt);
    if (historyScope && resource) {
      const report = await loadTeamKpiHistory(service, historyScope, generatedAt, resource);
      resource.check();
      return boundedReportJson({ ...report, diagnostics: resource.diagnostics });
    }
    if (resource) return jsonError(400, "INVALID_HISTORY_RANGE", "Unsupported report filters.");
    const targetDate = getCurrentISTDate();
    const report = parseTeamKpiResponse(await loadTeamKpiServerReport(service, targetDate));
    if (!report.totals.team_members) return jsonError(503, "TEAM_KPI_NO_ACTIVE_USERS", "Team KPI could not find active users.");
    return NextResponse.json(report, { headers: { "Cache-Control": "no-store, max-age=0", "X-Team-KPI-Source": "canonical-service-aggregation" } });
  } catch (error) {
    if (error instanceof ReportUnavailable) return jsonError(503, "HISTORY_UNAVAILABLE", "History exceeded its shared read deadline or budget. Retry a narrower range.");
    if (error instanceof HistoryRequestError) return jsonError(error.status, error.code, error.message);
    if (error instanceof TeamKpiServerError) return jsonError(error.status, error.code, error.message);
    console.error("Canonical Team KPI failed", error);
    return jsonError(500, "TEAM_KPI_SERVER_ERROR", "Team KPI could not load confirmed work data.");
  } finally { resource?.finish(); }
}
