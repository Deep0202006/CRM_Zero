import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { loadVisitReport, visitReportFiltersSchema } from "@/lib/fieldVisits/serverReport";

export const dynamic = "force-dynamic";

function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ code, message }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!url || !anonKey) return errorResponse(500, "SUPABASE_NOT_CONFIGURED", "Visit reporting is not configured.");
  if (!token) return errorResponse(401, "AUTHENTICATION_REQUIRED", "Sign in again.");

  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData.user) return errorResponse(401, "AUTHENTICATION_REQUIRED", "Your session has expired.");

  const params = new URL(request.url).searchParams;
  const parsed = visitReportFiltersSchema.safeParse({
    from: params.get("from"),
    to: params.get("to"),
    representative: params.get("representative") || null,
    segment: params.get("segment") || null,
    outcomes: params.getAll("outcome"),
    search: params.get("search") || null,
    page: params.get("page") || 1,
    pageSize: params.get("pageSize") || 50,
    sortDesc: params.get("sort") !== "asc",
  });
  if (!parsed.success) return errorResponse(400, "INVALID_VISIT_FILTERS", "The visit report filters are invalid.");

  try {
    const report = await loadVisitReport(client, parsed.data);
    return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const code = (error as { code?: string }).code ?? "VISIT_REPORT_FAILED";
    const status = code === "42501" ? 403 : code === "PGRST202" ? 503 : 500;
    return errorResponse(status, code, status === 403 ? "Administrator access is required." : "Visit reporting failed.");
  }
}
