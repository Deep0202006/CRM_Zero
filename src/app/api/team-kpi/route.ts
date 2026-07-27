import { NextRequest, NextResponse } from "next/server";
import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";
import { parseTeamKpiResponse, type TeamKpiResponse } from "@/lib/teamKpi/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

interface TeamKpiHealth {
  target_date?: string;
  active_users?: number;
  events?: number;
  calls?: number;
  client_queries?: number;
  mappings?: number;
  tasks?: number;
  latest_event_at?: string | null;
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

function sanitizePostgrestError(error: PostgrestError) {
  return {
    databaseCode: error.code || "UNKNOWN",
    databaseMessage: error.message || "Database request failed",
    hint: error.hint || undefined,
  };
}

async function loadHealth(client: SupabaseClient, targetDate: string): Promise<TeamKpiHealth | null> {
  const result = await client.rpc("get_team_kpi_health_v1", { target_date: targetDate });
  if (result.error || !result.data || typeof result.data !== "object") return null;
  return result.data as TeamKpiHealth;
}

async function loadLedgerReport(client: SupabaseClient, targetDate: string): Promise<TeamKpiResponse> {
  const result = await client.rpc("get_team_kpi_daily_v3", { target_date: targetDate });
  if (result.error) {
    const missingFunction =
      result.error.code === "42883" ||
      result.error.code === "PGRST202" ||
      /get_team_kpi_daily_v3|schema cache|not found/i.test(result.error.message ?? "");

    if (missingFunction) {
      throw Object.assign(new Error("Team KPI database ledger is not installed."), {
        code: "TEAM_KPI_LEDGER_NOT_INSTALLED",
        status: 503,
        database: sanitizePostgrestError(result.error),
      });
    }

    throw Object.assign(new Error("Team KPI database report failed."), {
      code: "TEAM_KPI_DATABASE_FAILED",
      status: 502,
      database: sanitizePostgrestError(result.error),
    });
  }

  const report = parseTeamKpiResponse(result.data);
  if (report.target_date !== targetDate) {
    throw Object.assign(new Error("Team KPI returned a different business date."), {
      code: "TEAM_KPI_DATE_MISMATCH",
      status: 502,
    });
  }
  if (report.source !== "team-work-events") {
    throw Object.assign(new Error("Team KPI returned an obsolete data source."), {
      code: "TEAM_KPI_OBSOLETE_SOURCE",
      status: 502,
    });
  }
  return report;
}

export async function GET(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
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

  const targetDate = request.nextUrl.searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return jsonError(400, "INVALID_DATE", "A valid Team KPI date is required.");
  }

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });

  try {
    const { data: userData, error: userError } = await client.auth.getUser(accessToken);
    if (userError || !userData.user) {
      return jsonError(401, "AUTHENTICATION_REQUIRED", "Your session has expired. Sign in again.");
    }

    const { data: ownCapabilities, error: capabilityError } = await client
      .from("user_capabilities")
      .select("capability_code")
      .eq("user_id", userData.user.id);

    if (capabilityError) {
      return jsonError(403, "AUTHORIZATION_CHECK_FAILED", "Team KPI authorization could not be verified.");
    }
    if (!(ownCapabilities ?? []).some((entry) => entry.capability_code === "admin")) {
      return jsonError(403, "ADMIN_REQUIRED", "Administrator access is required for Team KPI.");
    }

    const report = await loadLedgerReport(client, targetDate);

    // A successfully installed ledger must always return active users. Do not
    // silently convert an installation/data-contract defect into an empty UI.
    if (report.totals.team_members === 0) {
      const health = await loadHealth(client, targetDate);
      return jsonError(
        503,
        "TEAM_KPI_NO_ACTIVE_USERS",
        "Team KPI is connected, but no active team users were returned. Run the Team KPI verification SQL.",
        health ? { health } : undefined,
      );
    }

    return NextResponse.json(report, {
      status: 200,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    const candidate = error as {
      code?: string;
      status?: number;
      message?: string;
      database?: Record<string, unknown>;
    };

    if (candidate.code && candidate.status) {
      return jsonError(
        candidate.status,
        candidate.code,
        candidate.message ?? "Team KPI could not load confirmed work data.",
        candidate.database ? { database: candidate.database } : undefined,
      );
    }

    console.error("Team KPI API failed", error);
    return jsonError(500, "TEAM_KPI_SERVER_ERROR", "Team KPI could not load confirmed work data.");
  }
}
