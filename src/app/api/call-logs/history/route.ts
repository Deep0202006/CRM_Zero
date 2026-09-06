import { getCurrentISTDate } from "@/lib/dateTime";
import { backendUnavailableResponse, createServerAnonClient, createServerServiceClient } from "@/lib/serverBackendEnvironment";
import { getIstDayBounds } from "@/lib/teamKpi/serverReport";
import { loadCallHistoryWithOptionalMetrics } from "./service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;

function response(status: number, body: Record<string, unknown>) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function active(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true";
}

export async function GET(request: Request) {
  const authResult = createServerAnonClient(), serviceResult = createServerServiceClient();
  if (!authResult.ok || !serviceResult.ok) return backendUnavailableResponse();
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return response(401, { code: "AUTH_REQUIRED" });

  const authClient = authResult.client, service = serviceResult.client;
  const { data: auth, error: authError } = await authClient.auth.getUser(token);
  if (authError || !auth.user) return response(401, { code: "AUTH_REQUIRED" });

  const [{ data: account, error: accountError }, { data: capabilities, error: capabilityError }] = await Promise.all([
    service.from("users").select("user_id,is_active").eq("user_id", auth.user.id).maybeSingle(),
    service.from("user_capabilities").select("capability_code").eq("user_id", auth.user.id),
  ]);
  if (accountError || !account || !active(account.is_active)) return response(403, { code: "ACCOUNT_INACTIVE" });

  const requestUrl = new URL(request.url);
  const page = Math.max(1, Number.parseInt(requestUrl.searchParams.get("page") ?? "1", 10) || 1);
  const requestedAdminScope = requestUrl.searchParams.get("scope") === "admin";
  if (requestedAdminScope && capabilityError) return response(503, { code: "CAPABILITY_CHECK_FAILED" });
  const adminScope = requestedAdminScope && (capabilities ?? []).some((item) => item.capability_code === "admin");
  let historyQuery = service
    .from("call_logs")
    .select("log_id,user_id,lead_id,client_username,client_name,timestamp,outcome,notes,next_followup_date", { count: "exact" })
    .order("timestamp", { ascending: false })
    .order("log_id", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (!adminScope) historyQuery = historyQuery.eq("user_id", auth.user.id);

  const today = getCurrentISTDate();
  const { startsAt, endsAt } = getIstDayBounds(today);
  return loadCallHistoryWithOptionalMetrics({
    history: () => historyQuery,
    todayCalls: () => service.from("call_logs").select("log_id,user_id,timestamp,outcome,next_followup_date").eq("user_id", auth.user.id).gte("timestamp", startsAt).lt("timestamp", endsAt),
    tasks: () => service.from("tasks").select("task_id,assigned_to,assigned_by,completed_at,status,source,template_id,description").eq("assigned_to", auth.user.id).eq("is_active", true),
    taskHistory: () => service.from("task_status_history").select("id,task_id,changed_by,changed_at,new_status").eq("new_status", "Completed").gte("changed_at", startsAt).lt("changed_at", endsAt),
  }, auth.user.id, page);
}
