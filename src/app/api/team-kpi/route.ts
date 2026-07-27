import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { parseTeamKpiResponse, type TeamKpiResponse } from "@/lib/teamKpi/contract";
import { loadTeamKpiServerReport, TeamKpiServerError } from "@/lib/teamKpi/serverReport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonError(status: number, code: string, message: string) {
  return NextResponse.json(
    { code, message },
    {
      status,
      headers: { "Cache-Control": "no-store" },
    },
  );
}

async function tryDatabaseRpc(client: SupabaseClient, targetDate: string): Promise<TeamKpiResponse | null> {
  const result = await client.rpc("get_team_kpi_daily", { target_date: targetDate });
  if (result.error || result.data == null) return null;
  try {
    const report = parseTeamKpiResponse(result.data);
    return report.target_date === targetDate ? report : null;
  } catch {
    return null;
  }
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

    // Prefer the database function when migration 027 is installed. It is the
    // only path that can securely aggregate all users even when source-table RLS
    // intentionally hides rows from direct browser-context reads.
    const rpcReport = await tryDatabaseRpc(client, targetDate);
    if (rpcReport) {
      return NextResponse.json(rpcReport, {
        status: 200,
        headers: { "Cache-Control": "no-store, max-age=0" },
      });
    }

    // Keep a server-side source aggregation fallback so the page remains usable
    // before the optional RPC migration is applied. It still uses the caller's
    // authenticated RLS context and never exposes a service-role credential.
    const directReport = await loadTeamKpiServerReport(client, targetDate);
    return NextResponse.json(directReport, {
      status: 200,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    if (error instanceof TeamKpiServerError) {
      return jsonError(error.status, error.code, error.message);
    }
    console.error("Team KPI API failed", error);
    return jsonError(500, "TEAM_KPI_SERVER_ERROR", "Team KPI could not load confirmed work data.");
  }
}
