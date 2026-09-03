import { getCanonicalDailyTeamMetrics, isSyntheticAuditCall } from "../workMetrics/canonical";
import type { TeamKpiResponse, TeamKpiSourceWarning } from "./contract";
import { resolveAttendanceDay, type AttendanceAuthorityRow } from "@/lib/attendance/authority";

export interface KpiUserRecord { user_id: string; name: string; is_active: boolean | number | string | null; }
export interface KpiUserCapabilityRecord { user_id: string; capability_code: string; }
export interface KpiCapabilityRecord { code: string; label: string; }
export interface KpiCallRecord { log_id: string; user_id: string | null; timestamp: string; outcome: string | null; next_followup_date?: string | null; }
export interface KpiClientQueryRecord { query_id: string; assigned_to: string | null; resolved_by?: string | null; resolved_at: string | null; problem_status: string; }
export interface KpiMappingRecord { request_id: string; mapped_by: string | null; completed_at: string | null; status: string; }
export interface KpiTaskRecord { task_id: string; assigned_to: string | null; assigned_by?: string | null; completed_at: string | null; status: string; source?: string | null; template_id?: string | null; description?: string | null; }
export interface KpiTaskHistoryRecord { id: string; task_id: string; changed_by: string | null; changed_at: string; new_status: string; }
export interface KpiAllocatedTargetRecord { target_id: string; assigned_to_user_id: string | null; completed_at: string | null; is_completed: boolean; }
export interface BuildTeamKpiReportInput {
  targetDate: string; generatedAt?: string; users: KpiUserRecord[]; userCapabilities: KpiUserCapabilityRecord[]; capabilities: KpiCapabilityRecord[];
  calls: KpiCallRecord[]; clientQueries: KpiClientQueryRecord[]; mappings: KpiMappingRecord[]; tasks: KpiTaskRecord[]; taskHistory: KpiTaskHistoryRecord[];
  taskIdsWithAnyCompletionHistory?: ReadonlySet<string>; allocatedTargets: KpiAllocatedTargetRecord[]; warnings?: TeamKpiSourceWarning[]; source?: "server-aggregation" | "database-rpc";
  attendance?: AttendanceAuthorityRow[];
}

function isActive(value: KpiUserRecord["is_active"]): boolean {
  return value === true || value === 1 || (typeof value === "string" && ["1", "true", "t", "yes"].includes(value.trim().toLowerCase()));
}
function humanize(code: string): string { return code.split("_").filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(" "); }
export function isSyntheticCallOutcome(outcome: string | null): boolean { return isSyntheticAuditCall({ outcome }); }

export function buildTeamKpiReport(input: BuildTeamKpiReportInput): TeamKpiResponse {
  const codesByUser = new Map<string, string[]>();
  for (const assignment of input.userCapabilities) {
    const codes = codesByUser.get(assignment.user_id) ?? [];
    if (!codes.includes(assignment.capability_code)) codes.push(assignment.capability_code);
    codesByUser.set(assignment.user_id, codes);
  }
  const activeUsers = [...new Map(input.users.filter((user) =>
    isActive(user.is_active) &&
    user.name.trim().toLowerCase() !== "zerodataadmin" &&
    !codesByUser.get(user.user_id)?.includes("erp_partner_viewer"),
  ).map((user) => [user.user_id, user])).values()];
  const metrics = getCanonicalDailyTeamMetrics({
    userIds: activeUsers.map((user) => user.user_id), calls: input.calls, tasks: input.tasks, taskHistory: input.taskHistory,
    queries: input.clientQueries, mappings: input.mappings, targets: input.allocatedTargets,
  });
  const metricsByUser = new Map(metrics.map((metric) => [metric.user_id, metric]));
  const labels = new Map(input.capabilities.map((capability) => [capability.code, capability.label]));
  const warnings = [...(input.warnings ?? []), ...metrics.flatMap((metric) => metric.warnings)];
  const rows = activeUsers.map((user) => {
    const metric = metricsByUser.get(user.user_id)!;
    const codes = [...(codesByUser.get(user.user_id) ?? [])].sort();
    return {
      user_id: user.user_id, name: user.name.trim() || "Unnamed team member", role: codes.map((code) => labels.get(code) ?? humanize(code)).join(" · ") || "Team member", capabilities: codes,
      calls_made: metric.genuine_call_ids.size, followup_calls: metric.followup_call_ids.size, queries_handled: metric.query_ids.size, mappings_completed: metric.mapping_ids.size,
      tasks_completed: metric.completed_task_ids.size + metric.target_ids.size, total_completed_work: metric.unique_work_keys.size,
      attendance_status: resolveAttendanceDay(input.attendance ?? [], user.user_id, input.targetDate).present ? "Present" as const : "Absent" as const,
      latest_activity_time: metric.latest_activity_at,
    };
  }).sort((a, b) => b.total_completed_work - a.total_completed_work || a.name.localeCompare(b.name) || a.user_id.localeCompare(b.user_id));
  const totals = rows.reduce((sum, row) => ({ team_members: sum.team_members + 1, calls_made: sum.calls_made + row.calls_made, followup_calls: sum.followup_calls + row.followup_calls, queries_handled: sum.queries_handled + row.queries_handled, mappings_completed: sum.mappings_completed + row.mappings_completed, tasks_completed: sum.tasks_completed + row.tasks_completed, total_completed_work: sum.total_completed_work + row.total_completed_work }), { team_members: 0, calls_made: 0, followup_calls: 0, queries_handled: 0, mappings_completed: 0, tasks_completed: 0, total_completed_work: 0 });
  return { target_date: input.targetDate, generated_at: input.generatedAt ?? new Date().toISOString(), rows, totals, source: input.source ?? "server-aggregation", warnings };
}
