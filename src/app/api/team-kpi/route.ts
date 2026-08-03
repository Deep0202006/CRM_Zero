import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getCurrentISTDate } from "@/lib/dateTime";
import { parseTeamKpiResponse } from "@/lib/teamKpi/contract";
import { loadTeamKpiServerReport, TeamKpiServerError } from "@/lib/teamKpi/serverReport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json({ code, message }, { status, headers: { "Cache-Control": "no-store, max-age=0" } });
}
function client(url: string, key: string, token?: string): SupabaseClient {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, ...(token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {}) });
}
function active(value: unknown): boolean { return value === true || value === 1 || (typeof value === "string" && ["1", "true", "t"].includes(value.toLowerCase())); }
async function isAdmin(service: SupabaseClient, userId: string): Promise<boolean> {
  const [{ data: user }, { data: capabilities }] = await Promise.all([
    service.from("users").select("user_id,is_active").eq("user_id", userId).maybeSingle(),
    service.from("user_capabilities").select("capability_code").eq("user_id", userId),
  ]);
  return Boolean(user && active(user.is_active) && (capabilities ?? []).some((item: { capability_code: string }) => item.capability_code === "admin"));
}

export async function GET(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !serviceKey || serviceKey === "BUILD_TIME_PLACEHOLDER_KEY") return jsonError(500, "SUPABASE_NOT_CONFIGURED", "Canonical Team KPI server access is not configured.");
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return jsonError(401, "AUTHENTICATION_REQUIRED", "Sign in again to view Team KPI.");
  const token = authorization.slice(7).trim();
  const userClient = client(url, anon, token);
  const service = client(url, serviceKey);
  try {
    const { data, error } = await userClient.auth.getUser(token);
    if (error || !data.user) return jsonError(401, "AUTHENTICATION_REQUIRED", "Your session has expired. Sign in again.");
    if (!(await isAdmin(service, data.user.id))) return jsonError(403, "ADMIN_REQUIRED", "Administrator access is required for Team KPI.");
    const targetDate = getCurrentISTDate();
    const report = parseTeamKpiResponse(await loadTeamKpiServerReport(service, targetDate));
    if (!report.totals.team_members) return jsonError(503, "TEAM_KPI_NO_ACTIVE_USERS", "Team KPI could not find active users.");
    return NextResponse.json(report, { headers: { "Cache-Control": "no-store, max-age=0", "X-Team-KPI-Source": "canonical-service-aggregation" } });
  } catch (error) {
    if (error instanceof TeamKpiServerError) return jsonError(error.status, error.code, error.message);
    console.error("Canonical Team KPI failed", error);
    return jsonError(500, "TEAM_KPI_SERVER_ERROR", "Team KPI could not load confirmed work data.");
  }
}
