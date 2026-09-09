import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReportResource } from "@/lib/analytics/reportResource";
import { buildTeamKpiReport, getTeamKpiParticipants, type KpiUserRecord, type KpiUserCapabilityRecord, type KpiCapabilityRecord } from "./aggregate";
import { buildHistoryReport, HistoryRequestError, type HistoryScope } from "./history";
import { readRetainedHistory } from "./retainedHistoryServer";

// Hard response/request ceilings, not a claim about production query latency.
export const HISTORY_BUDGET = { participants: 200, capabilities: 1000, labels: 100, pageSize: 1000, callPages: 21, requests: 24 } as const;

export async function loadHistoryCohort(client: SupabaseClient, scope: HistoryScope, resource: ReportResource) {
  const usersResult = await resource.read(client.from("users").select("user_id,name,is_active", { count: "exact" }).eq("is_active", true).order("user_id").limit(HISTORY_BUDGET.participants + 1));
  const complete = (result: { error: unknown; count: number | null; data: unknown[] | null }, cap: number) => !result.error && result.count !== null && result.count <= cap && result.data?.length === result.count;
  if (!complete(usersResult, HISTORY_BUDGET.participants)) throw new HistoryRequestError("HISTORY_COHORT_UNAVAILABLE", "The active directory is unavailable or exceeds the 200-person history limit.", 503);
  const users = usersResult.data as KpiUserRecord[];
  if (!users.length) throw new HistoryRequestError("TEAM_KPI_NO_ACTIVE_USERS", "No active team members are available.", 503);
  const assignmentsResult = await resource.read(client.from("user_capabilities").select("user_id,capability_code", { count: "exact" }).in("user_id", users.map((row) => row.user_id)).order("user_id").order("capability_code").limit(HISTORY_BUDGET.capabilities + 1));
  if (!complete(assignmentsResult, HISTORY_BUDGET.capabilities)) throw new HistoryRequestError("HISTORY_COHORT_UNAVAILABLE", "Participant capabilities could not be read completely.", 503);
  const assignments = assignmentsResult.data as KpiUserCapabilityRecord[];
  const participants = getTeamKpiParticipants(users, assignments);
  if (!participants.length) throw new HistoryRequestError("TEAM_KPI_NO_ACTIVE_USERS", "No internal team members are available.", 503);
  if (scope.employee && !participants.some((row) => row.user_id === scope.employee)) throw new HistoryRequestError("HISTORY_EMPLOYEE_UNAVAILABLE", "The selected employee is outside the current report cohort.", 404);
  const codes = [...new Set(assignments.map((row) => row.capability_code))];
  const labelResult = codes.length ? await resource.read(client.from("capabilities").select("code,label", { count: "exact" }).in("code", codes).order("code").limit(HISTORY_BUDGET.labels + 1)) : { data: [], count: 0, error: null };
  if (!complete(labelResult, HISTORY_BUDGET.labels)) throw new HistoryRequestError("HISTORY_COHORT_UNAVAILABLE", "Capability labels could not be read completely.", 503);
  return buildTeamKpiReport({ targetDate: scope.to, users: participants, userCapabilities: assignments, capabilities: labelResult.data as KpiCapabilityRecord[], calls: [], clientQueries: [], mappings: [], tasks: [], taskHistory: [], allocatedTargets: [] }).rows.map(({ user_id, name, role }) => ({ user_id, name, role })).sort((a, b) => a.name.localeCompare(b.name, "en-IN") || a.user_id.localeCompare(b.user_id));
}

export async function loadTeamKpiHistory(client: SupabaseClient, scope: HistoryScope, generatedAt: string, resource: ReportResource) {
  const members = await loadHistoryCohort(client, scope, resource);
  try {
    const source = await readRetainedHistory(client, scope, members.map(row => row.user_id), generatedAt, resource);
    return buildHistoryReport({ scope, generatedAt, members, ...source, requests: resource.diagnostics.reader_requests });
  } catch {
    resource.check();
    return buildHistoryReport({ scope, generatedAt, members, calls: [], requests: resource.diagnostics.reader_requests, sourceError: "Selected source could not be exhausted within its bounded read. Narrow the range or retry; no partial totals are presented." });
  }
}
