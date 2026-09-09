import type { SupabaseClient } from "@supabase/supabase-js";
import { getISTBusinessDayBounds } from "@/lib/dateTime";
import { buildTeamKpiReport, getTeamKpiParticipants, type KpiUserRecord, type KpiUserCapabilityRecord, type KpiCapabilityRecord, type KpiCallRecord } from "./aggregate";
import { buildHistoryReport, HistoryRequestError, type HistoryScope } from "./history";

// Hard response/request ceilings, not a claim about production query latency.
export const HISTORY_BUDGET = { participants: 200, capabilities: 1000, labels: 100, pageSize: 1000, callPages: 20, requests: 24 } as const;

export async function loadTeamKpiHistory(client: SupabaseClient, scope: HistoryScope, generatedAt: string) {
  let requests = 0;
  const charge = () => { if (++requests > HISTORY_BUDGET.requests) throw new HistoryRequestError("HISTORY_QUERY_BUDGET", "History query budget exceeded.", 413); };
  charge();
  const usersResult = await client.from("users").select("user_id,name,is_active", { count: "exact" }).eq("is_active", true).order("user_id").limit(HISTORY_BUDGET.participants + 1);
  const complete = (result: { error: unknown; count: number | null; data: unknown[] | null }, cap: number) => !result.error && result.count !== null && result.count <= cap && result.data?.length === result.count;
  if (!complete(usersResult, HISTORY_BUDGET.participants)) throw new HistoryRequestError("HISTORY_COHORT_UNAVAILABLE", "The active directory is unavailable or exceeds the 200-person history limit.", 503);
  const users = usersResult.data as KpiUserRecord[];
  if (!users.length) throw new HistoryRequestError("TEAM_KPI_NO_ACTIVE_USERS", "No active team members are available.", 503);
  charge();
  const assignmentsResult = await client.from("user_capabilities").select("user_id,capability_code", { count: "exact" }).in("user_id", users.map((row) => row.user_id)).order("user_id").order("capability_code").limit(HISTORY_BUDGET.capabilities + 1);
  if (!complete(assignmentsResult, HISTORY_BUDGET.capabilities)) throw new HistoryRequestError("HISTORY_COHORT_UNAVAILABLE", "Participant capabilities could not be read completely.", 503);
  const assignments = assignmentsResult.data as KpiUserCapabilityRecord[];
  const participants = getTeamKpiParticipants(users, assignments);
  if (!participants.length) throw new HistoryRequestError("TEAM_KPI_NO_ACTIVE_USERS", "No internal team members are available.", 503);
  if (scope.employee && !participants.some((row) => row.user_id === scope.employee)) throw new HistoryRequestError("HISTORY_EMPLOYEE_UNAVAILABLE", "The selected employee is outside the current report cohort.", 404);
  const codes = [...new Set(assignments.map((row) => row.capability_code))];
  if (codes.length) charge();
  const labelResult = codes.length ? await client.from("capabilities").select("code,label", { count: "exact" }).in("code", codes).order("code").limit(HISTORY_BUDGET.labels + 1) : { data: [], count: 0, error: null };
  if (!complete(labelResult, HISTORY_BUDGET.labels)) throw new HistoryRequestError("HISTORY_COHORT_UNAVAILABLE", "Capability labels could not be read completely.", 503);
  const members = buildTeamKpiReport({ targetDate: scope.to, users: participants, userCapabilities: assignments, capabilities: labelResult.data as KpiCapabilityRecord[], calls: [], clientQueries: [], mappings: [], tasks: [], taskHistory: [], allocatedTargets: [] }).rows.map(({ user_id, name, role }) => ({ user_id, name, role })).sort((a, b) => a.name.localeCompare(b.name, "en-IN") || a.user_id.localeCompare(b.user_id));
  const start = getISTBusinessDayBounds(scope.previous_from).startsAt, end = [getISTBusinessDayBounds(scope.to).endsAt, generatedAt].sort()[0];
  const calls: KpiCallRecord[] = [];
  let sourceError: string | null = "Calls exceeded the bounded history page limit. Narrow the range.";
  for (let page = 0; page < HISTORY_BUDGET.callPages; page++) {
    charge();
    const result = await client.from("call_logs").select("log_id,user_id,timestamp,outcome").in("user_id", participants.map((row) => row.user_id)).gte("timestamp", start).lt("timestamp", end).order("timestamp").order("log_id").range(page * HISTORY_BUDGET.pageSize, (page + 1) * HISTORY_BUDGET.pageSize - 1);
    if (result.error || !result.data) { sourceError = "Calls could not be read completely. Retry this report."; break; }
    calls.push(...result.data as KpiCallRecord[]);
    if (result.data.length < HISTORY_BUDGET.pageSize) { sourceError = null; break; }
  }
  return buildHistoryReport({ scope, generatedAt, members, calls: sourceError ? [] : calls, requests, sourceError });
}
