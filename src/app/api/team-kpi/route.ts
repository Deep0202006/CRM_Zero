import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  parseTeamKpiResponse,
  type TeamKpiResponse,
  type TeamKpiRow,
} from "@/lib/teamKpi/contract";
import { loadTeamKpiServerReport, TeamKpiServerError } from "@/lib/teamKpi/serverReport";
import { getCurrentISTDate } from "@/lib/dateTime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface TeamKpiRpcRow {
  selected_date?: string;
  user_id: string;
  user_name?: string | null;
  role_label?: string | null;
  capabilities?: string[] | null;
  calls_count?: number | string | null;
  client_queries_count?: number | string | null;
  mappings_count?: number | string | null;
  tasks_completed_count?: number | string | null;
  total_work_count?: number | string | null;
  last_activity_at?: string | null;
}

function jsonError(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
) {
  return NextResponse.json(
    { code, message, ...(details ? { details } : {}) },
    {
      status,
      headers: { "Cache-Control": "no-store, max-age=0" },
    },
  );
}

function isConfiguredServiceKey(value: string | undefined): value is string {
  return Boolean(value && value !== "BUILD_TIME_PLACEHOLDER_KEY" && value.length > 40);
}

function createUserScopedClient(url: string, anonKey: string, accessToken: string): SupabaseClient {
  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
}

function createServiceClient(url: string, serviceKey: string): SupabaseClient {
  return createClient(url, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function toCount(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
}

function reportFromRpcRows(targetDate: string, rawRows: TeamKpiRpcRow[]): TeamKpiResponse {
  const seenUsers = new Set<string>();
  const rows: TeamKpiRow[] = rawRows.map((row) => {
    if (row.selected_date && row.selected_date !== targetDate) {
      throw new TeamKpiServerError(
        "TEAM_KPI_DATE_MISMATCH",
        "Team KPI returned a different business date than requested.",
        502,
      );
    }
    if (seenUsers.has(row.user_id)) {
      throw new TeamKpiServerError(
        "TEAM_KPI_DUPLICATE_USER",
        "Team KPI returned duplicate rows for one team member.",
        502,
      );
    }
    seenUsers.add(row.user_id);

    const calls = toCount(row.calls_count);
    const clientQueries = toCount(row.client_queries_count);
    const mappings = toCount(row.mappings_count);
    const tasks = toCount(row.tasks_completed_count);

    return {
      user_id: row.user_id,
      name: row.user_name?.trim() || "Unnamed team member",
      role: row.role_label?.trim() || "Team member",
      capabilities: Array.isArray(row.capabilities) ? row.capabilities.filter(Boolean) : [],
      calls_made: calls,
      queries_handled: clientQueries,
      mappings_completed: mappings,
      tasks_completed: tasks,
      total_completed_work: calls + clientQueries + mappings + tasks,
      latest_activity_time: row.last_activity_at ?? null,
    };
  });

  const totals = rows.reduce(
    (summary, row) => ({
      team_members: summary.team_members + 1,
      calls_made: summary.calls_made + row.calls_made,
      queries_handled: summary.queries_handled + row.queries_handled,
      mappings_completed: summary.mappings_completed + row.mappings_completed,
      tasks_completed: summary.tasks_completed + row.tasks_completed,
      total_completed_work: summary.total_completed_work + row.total_completed_work,
    }),
    {
      team_members: 0,
      calls_made: 0,
      queries_handled: 0,
      mappings_completed: 0,
      tasks_completed: 0,
      total_completed_work: 0,
    },
  );

  return parseTeamKpiResponse({
    target_date: targetDate,
    generated_at: new Date().toISOString(),
    rows,
    totals,
    source: "database-rpc",
    schema_version: 4,
    warnings: [],
  });
}

function isMissingRpc(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    /get_team_kpi_daily_v4.*(not found|schema cache|does not exist)/i.test(error.message ?? "")
  );
}

function isPermissionError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42501" || /administrator access|required|permission denied|unauthorized/i.test(error.message ?? "");
}

function isActiveUserValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") return ["1", "true", "t"].includes(value.trim().toLowerCase());
  return false;
}

async function verifyAdmin(client: SupabaseClient, userId: string): Promise<boolean> {
  const [{ data: publicUser, error: userError }, { data: capabilities, error: capabilityError }] = await Promise.all([
    client.from("users").select("user_id,is_active").eq("user_id", userId).maybeSingle(),
    client.from("user_capabilities").select("capability_code").eq("user_id", userId),
  ]);

  if (userError || capabilityError || !publicUser || !isActiveUserValue(publicUser.is_active)) return false;
  return (capabilities ?? []).some((entry: { capability_code: string }) => entry.capability_code === "admin");
}

export async function GET(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return jsonError(500, "SUPABASE_NOT_CONFIGURED", "Team KPI server access is not configured.");
  }

  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return jsonError(401, "AUTHENTICATION_REQUIRED", "Sign in again to view Team KPI.");
  }
  const accessToken = authorization.slice("Bearer ".length).trim();
  if (!accessToken) {
    return jsonError(401, "AUTHENTICATION_REQUIRED", "Sign in again to view Team KPI.");
  }

  // Team KPI is deliberately today-only. Ignore all client-supplied dates so
  // an old bookmark or modified request cannot browse historical reports.
  const targetDate = getCurrentISTDate();

  const userClient = createUserScopedClient(supabaseUrl, supabaseAnonKey, accessToken);
  const serviceClient = isConfiguredServiceKey(serviceRoleKey)
    ? createServiceClient(supabaseUrl, serviceRoleKey)
    : null;

  try {
    const { data: userData, error: userError } = await userClient.auth.getUser(accessToken);
    if (userError || !userData.user) {
      return jsonError(401, "AUTHENTICATION_REQUIRED", "Your session has expired. Sign in again.");
    }

    // Primary path: a narrowly scoped SECURITY DEFINER RPC. It validates the
    // authenticated admin itself and returns every active user, including zeros.
    const { data: rpcRows, error: rpcError } = await userClient.rpc("get_team_kpi_daily_v4", {
      p_target_date: targetDate,
    });

    if (!rpcError) {
      const report = reportFromRpcRows(targetDate, (rpcRows ?? []) as TeamKpiRpcRow[]);
      if (report.totals.team_members === 0) {
        return jsonError(
          503,
          "TEAM_KPI_NO_ACTIVE_USERS",
          "Team KPI is connected, but the active user directory returned no users.",
        );
      }
      return NextResponse.json(report, {
        status: 200,
        headers: {
          "Cache-Control": "no-store, max-age=0",
          "X-Team-KPI-Source": "database-rpc-v4",
        },
      });
    }

    if (isPermissionError(rpcError)) {
      return jsonError(403, "ADMIN_REQUIRED", "Administrator access is required for Team KPI.");
    }

    // Controlled fallback: only a server-side service client may aggregate raw
    // source tables. Browser/RLS-limited aggregation is deliberately forbidden.
    if (serviceClient) {
      const isAdmin = await verifyAdmin(serviceClient, userData.user.id);
      if (!isAdmin) {
        return jsonError(403, "ADMIN_REQUIRED", "Administrator access is required for Team KPI.");
      }

      const warnings = [{
        source: "database RPC",
        message: isMissingRpc(rpcError)
          ? "Team KPI migration 029 is not installed or PostgREST has not refreshed; the secure server fallback supplied this report."
          : `The Team KPI RPC failed (${rpcError.code ?? "unknown"}); the secure server fallback supplied this report.`,
      }];
      const report = parseTeamKpiResponse(
        await loadTeamKpiServerReport(serviceClient, targetDate, warnings),
      );
      if (report.totals.team_members === 0) {
        return jsonError(503, "TEAM_KPI_NO_ACTIVE_USERS", "Team KPI could not find active users.");
      }

      return NextResponse.json(report, {
        status: 200,
        headers: {
          "Cache-Control": "no-store, max-age=0",
          "X-Team-KPI-Source": "service-role-server-aggregation",
        },
      });
    }

    if (isMissingRpc(rpcError)) {
      return jsonError(
        503,
        "TEAM_KPI_V4_NOT_INSTALLED",
        "Team KPI database migration 029 has not been applied or the schema cache is stale.",
        { supabaseCode: rpcError.code ?? "UNKNOWN" },
      );
    }

    console.error("Team KPI RPC failed", {
      code: rpcError.code ?? "UNKNOWN",
      message: rpcError.message,
    });
    return jsonError(
      503,
      "TEAM_KPI_DATABASE_FAILED",
      "The database could not produce Team KPI data.",
      { supabaseCode: rpcError.code ?? "UNKNOWN" },
    );
  } catch (error) {
    if (error instanceof TeamKpiServerError) {
      return jsonError(error.status, error.code, error.message);
    }

    const candidate = error as { code?: string; message?: string };
    console.error("Team KPI API failed", {
      code: candidate.code ?? "UNKNOWN",
      message: candidate.message ?? "Unknown Team KPI failure",
    });
    return jsonError(500, "TEAM_KPI_SERVER_ERROR", "Team KPI could not load confirmed work data.");
  }
}
