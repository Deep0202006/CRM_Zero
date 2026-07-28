import type { TeamKpiResponse, TeamKpiRow, TeamKpiSourceWarning } from "./contract";

export interface KpiUserRecord {
  user_id: string;
  name: string;
  is_active: boolean | number | string | null;
}

export interface KpiUserCapabilityRecord {
  user_id: string;
  capability_code: string;
}

export interface KpiCapabilityRecord {
  code: string;
  label: string;
}

export interface KpiCallRecord {
  log_id: string;
  user_id: string | null;
  timestamp: string;
  outcome: string | null;
}

export interface KpiClientQueryRecord {
  query_id: string;
  assigned_to: string | null;
  resolved_by?: string | null;
  resolved_at: string | null;
  problem_status: string;
}

export interface KpiMappingRecord {
  request_id: string;
  mapped_by: string | null;
  completed_at: string | null;
  status: string;
}

export interface KpiTaskRecord {
  task_id: string;
  assigned_to: string | null;
  completed_at: string | null;
  status: string;
}

export interface KpiTaskHistoryRecord {
  id: string;
  task_id: string;
  changed_by: string | null;
  changed_at: string;
  new_status: string;
}

export interface KpiAllocatedTargetRecord {
  target_id: string;
  assigned_to_user_id: string | null;
  completed_at: string | null;
  is_completed: boolean;
}

export interface BuildTeamKpiReportInput {
  targetDate: string;
  generatedAt?: string;
  users: KpiUserRecord[];
  userCapabilities: KpiUserCapabilityRecord[];
  capabilities: KpiCapabilityRecord[];
  calls: KpiCallRecord[];
  clientQueries: KpiClientQueryRecord[];
  mappings: KpiMappingRecord[];
  tasks: KpiTaskRecord[];
  taskHistory: KpiTaskHistoryRecord[];
  taskIdsWithAnyCompletionHistory?: ReadonlySet<string>;
  allocatedTargets: KpiAllocatedTargetRecord[];
  warnings?: TeamKpiSourceWarning[];
  source?: "server-aggregation" | "database-rpc";
}

function isActive(value: KpiUserRecord["is_active"]): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === "string") {
    return ["1", "true", "t", "yes"].includes(value.trim().toLowerCase());
  }
  return false;
}

function humanizeCapability(code: string): string {
  return code
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function maxTimestamp(current: string | null, candidate: string | null | undefined): string | null {
  if (!candidate) return current;
  const candidateTime = Date.parse(candidate);
  if (!Number.isFinite(candidateTime)) return current;
  if (!current) return candidate;
  const currentTime = Date.parse(current);
  return !Number.isFinite(currentTime) || candidateTime > currentTime ? candidate : current;
}

export function isSyntheticCallOutcome(outcome: string | null): boolean {
  if (!outcome) return false;
  const normalized = outcome.trim().toLowerCase();
  return (
    outcome.includes("→") ||
    normalized.startsWith("[stage note]") ||
    normalized.startsWith("[call outcome] →") ||
    normalized.startsWith("pipeline stage")
  );
}

interface MutableMetricRow extends TeamKpiRow {
  callIds: Set<string>;
  queryIds: Set<string>;
  mappingIds: Set<string>;
  normalTaskIds: Set<string>;
  allocatedTargetIds: Set<string>;
}

export function buildTeamKpiReport(input: BuildTeamKpiReportInput): TeamKpiResponse {
  const capabilityLabels = new Map(input.capabilities.map((capability) => [capability.code, capability.label]));
  const capabilityCodesByUser = new Map<string, string[]>();

  for (const assignment of input.userCapabilities) {
    const existing = capabilityCodesByUser.get(assignment.user_id) ?? [];
    if (!existing.includes(assignment.capability_code)) existing.push(assignment.capability_code);
    capabilityCodesByUser.set(assignment.user_id, existing);
  }

  const rowsByUser = new Map<string, MutableMetricRow>();
  for (const user of input.users) {
    if (!isActive(user.is_active)) continue;
    const codes = [...(capabilityCodesByUser.get(user.user_id) ?? [])].sort();
    const labels = codes.map((code) => capabilityLabels.get(code) ?? humanizeCapability(code));
    rowsByUser.set(user.user_id, {
      user_id: user.user_id,
      name: user.name.trim() || "Unnamed team member",
      role: labels.length > 0 ? labels.join(" · ") : "Team member",
      capabilities: codes,
      calls_made: 0,
      queries_handled: 0,
      mappings_completed: 0,
      tasks_completed: 0,
      total_completed_work: 0,
      latest_activity_time: null,
      callIds: new Set<string>(),
      queryIds: new Set<string>(),
      mappingIds: new Set<string>(),
      normalTaskIds: new Set<string>(),
      allocatedTargetIds: new Set<string>(),
    });
  }

  for (const call of input.calls) {
    if (!call.user_id || isSyntheticCallOutcome(call.outcome)) continue;
    const row = rowsByUser.get(call.user_id);
    if (!row || row.callIds.has(call.log_id)) continue;
    row.callIds.add(call.log_id);
    row.calls_made += 1;
    row.latest_activity_time = maxTimestamp(row.latest_activity_time, call.timestamp);
  }

  for (const query of input.clientQueries) {
    if (query.problem_status.toLowerCase() !== "resolved" || !query.resolved_at) continue;
    const actor = query.resolved_by ?? query.assigned_to;
    if (!actor) continue;
    const row = rowsByUser.get(actor);
    if (!row || row.queryIds.has(query.query_id)) continue;
    row.queryIds.add(query.query_id);
    row.queries_handled += 1;
    row.latest_activity_time = maxTimestamp(row.latest_activity_time, query.resolved_at);
  }

  for (const mapping of input.mappings) {
    const completedStatus = ["completed", "resolved"].includes(mapping.status.trim().toLowerCase());
    if (!completedStatus || !mapping.mapped_by || !mapping.completed_at) continue;
    const row = rowsByUser.get(mapping.mapped_by);
    if (!row || row.mappingIds.has(mapping.request_id)) continue;
    row.mappingIds.add(mapping.request_id);
    row.mappings_completed += 1;
    row.latest_activity_time = maxTimestamp(row.latest_activity_time, mapping.completed_at);
  }

  const tasksById = new Map(input.tasks.map((task) => [task.task_id, task]));
  const completionHistoryByTask = new Map<string, KpiTaskHistoryRecord>();
  for (const event of input.taskHistory) {
    if (event.new_status.toLowerCase() !== "completed") continue;
    const current = completionHistoryByTask.get(event.task_id);
    if (!current || Date.parse(event.changed_at) > Date.parse(current.changed_at)) {
      completionHistoryByTask.set(event.task_id, event);
    }
  }

  for (const event of completionHistoryByTask.values()) {
    const task = tasksById.get(event.task_id);
    const actor = event.changed_by ?? task?.assigned_to ?? null;
    if (!actor) continue;
    const row = rowsByUser.get(actor);
    if (!row || row.normalTaskIds.has(event.task_id)) continue;
    row.normalTaskIds.add(event.task_id);
    row.tasks_completed += 1;
    row.latest_activity_time = maxTimestamp(row.latest_activity_time, event.changed_at);
  }

  const taskIdsWithAnyHistory = input.taskIdsWithAnyCompletionHistory ?? new Set(completionHistoryByTask.keys());
  for (const task of input.tasks) {
    if (task.status.toLowerCase() !== "completed" || !task.assigned_to || !task.completed_at) continue;
    if (taskIdsWithAnyHistory.has(task.task_id)) continue;
    const row = rowsByUser.get(task.assigned_to);
    if (!row || row.normalTaskIds.has(task.task_id)) continue;
    row.normalTaskIds.add(task.task_id);
    row.tasks_completed += 1;
    row.latest_activity_time = maxTimestamp(row.latest_activity_time, task.completed_at);
  }

  for (const target of input.allocatedTargets) {
    if (!target.is_completed || !target.assigned_to_user_id || !target.completed_at) continue;
    const row = rowsByUser.get(target.assigned_to_user_id);
    if (!row || row.allocatedTargetIds.has(target.target_id)) continue;
    row.allocatedTargetIds.add(target.target_id);
    row.tasks_completed += 1;
    row.latest_activity_time = maxTimestamp(row.latest_activity_time, target.completed_at);
  }

  const rows: TeamKpiRow[] = [...rowsByUser.values()]
    .map((row) => ({
      user_id: row.user_id,
      name: row.name,
      role: row.role,
      capabilities: row.capabilities,
      calls_made: row.calls_made,
      queries_handled: row.queries_handled,
      mappings_completed: row.mappings_completed,
      tasks_completed: row.tasks_completed,
      total_completed_work: row.calls_made + row.queries_handled + row.mappings_completed + row.tasks_completed,
      latest_activity_time: row.latest_activity_time,
    }))
    .sort(
      (a, b) =>
        b.total_completed_work - a.total_completed_work ||
        a.name.localeCompare(b.name) ||
        a.user_id.localeCompare(b.user_id),
    );

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

  return {
    target_date: input.targetDate,
    generated_at: input.generatedAt ?? new Date().toISOString(),
    rows,
    totals,
    source: input.source ?? "server-aggregation",
    warnings: input.warnings ?? [],
  };
}
