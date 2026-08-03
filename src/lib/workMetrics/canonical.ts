export interface CanonicalCallLog {
  log_id: string;
  user_id?: string | null;
  timestamp: string;
  outcome: string | null;
  next_followup_date?: string | null;
}

export interface CanonicalTask {
  task_id: string;
  assigned_to: string | null;
  assigned_by?: string | null;
  completed_at: string | null;
  status: string;
  source?: string | null;
  template_id?: string | null;
  description?: string | null;
}

export interface CanonicalTaskHistory {
  id: string;
  task_id: string;
  changed_by: string | null;
  changed_at: string;
  new_status: string;
}

export interface CanonicalQuery { query_id: string; assigned_to: string | null; resolved_by?: string | null; resolved_at: string | null; problem_status: string; }
export interface CanonicalMapping { request_id: string; mapped_by: string | null; completed_at: string | null; status: string; }
export interface CanonicalTarget { target_id: string; assigned_to_user_id: string | null; completed_at: string | null; is_completed: boolean; }

export interface CanonicalMetricWarning { source: string; message: string; }
export interface CanonicalDailyUserMetrics {
  user_id: string;
  genuine_call_ids: Set<string>;
  followup_call_ids: Set<string>;
  query_ids: Set<string>;
  mapping_ids: Set<string>;
  completed_task_ids: Set<string>;
  followup_task_ids: Set<string>;
  target_ids: Set<string>;
  unique_work_keys: Set<string>;
  pending_followups: number;
  latest_activity_at: string | null;
  warnings: CanonicalMetricWarning[];
}

const KNOWN_SYNTHETIC_PATTERNS = [
  /(?:→|â†’)/u,
  /^\s*\[stage note\]/i,
  /^\s*\[call outcome\]\s*(?:→|â†’)/iu,
  /^\s*pipeline[ -]?stage(?:\s+audit|\s+transition|:)/i,
];
const AUDIT_LIKE_PATTERN = /\b(?:pipeline|stage|transition|audit|system[- ]generated)\b/i;
const FOLLOWUP_CONTRACT = /Scheduled follow-up for:/i;

export function isSyntheticAuditCall(call: Pick<CanonicalCallLog, "outcome">): boolean {
  const outcome = call.outcome ?? "";
  return KNOWN_SYNTHETIC_PATTERNS.some((pattern) => pattern.test(outcome));
}

export function isGenuineCallLog(call: Pick<CanonicalCallLog, "log_id" | "user_id" | "timestamp" | "outcome">): boolean {
  return Boolean(call.log_id && call.user_id && call.timestamp) && !isSyntheticAuditCall(call);
}

export function isFollowUpCompletionCall(call: Pick<CanonicalCallLog, "log_id" | "user_id" | "timestamp" | "outcome">, task?: CanonicalTask): boolean {
  if (!task || call.log_id !== task.task_id || !isGenuineCallLog(call)) return false;
  return task.source === "manual" && task.template_id == null && FOLLOWUP_CONTRACT.test(task.description ?? "");
}

export function reconcileFollowUpPair(call: CanonicalCallLog, task: CanonicalTask): { linked: boolean; warning?: string } {
  if (!isFollowUpCompletionCall(call, task)) return { linked: false };
  if (!task.assigned_to || call.user_id !== task.assigned_to || task.assigned_by !== task.assigned_to) {
    return { linked: false, warning: `Follow-up ${task.task_id} has a cross-user identity mismatch.` };
  }
  if (!task.completed_at || Number.isNaN(Date.parse(task.completed_at)) || Number.isNaN(Date.parse(call.timestamp))) {
    return { linked: false, warning: `Follow-up ${task.task_id} lacks conclusive completion time evidence.` };
  }
  if (Math.abs(Date.parse(task.completed_at) - Date.parse(call.timestamp)) > 5 * 60_000) {
    return { linked: false, warning: `Follow-up ${task.task_id} completion timestamps do not match.` };
  }
  return { linked: true };
}

export function buildUniqueWorkKey(kind: "call" | "query" | "mapping" | "task" | "target" | "followup", id: string): string {
  return `${kind}:${id}`;
}

function maxTime(current: string | null, candidate: string | null | undefined): string | null {
  if (!candidate || Number.isNaN(Date.parse(candidate))) return current;
  return !current || Date.parse(candidate) > Date.parse(current) ? candidate : current;
}

export function getCanonicalDailyUserMetrics(input: {
  userId: string; calls: CanonicalCallLog[]; tasks: CanonicalTask[]; taskHistory: CanonicalTaskHistory[];
  queries?: CanonicalQuery[]; mappings?: CanonicalMapping[]; targets?: CanonicalTarget[];
}): CanonicalDailyUserMetrics {
  const result: CanonicalDailyUserMetrics = {
    user_id: input.userId, genuine_call_ids: new Set(), followup_call_ids: new Set(), query_ids: new Set(), mapping_ids: new Set(),
    completed_task_ids: new Set(), followup_task_ids: new Set(), target_ids: new Set(), unique_work_keys: new Set(), pending_followups: 0,
    latest_activity_at: null, warnings: [],
  };
  const tasksById = new Map(input.tasks.map((task) => [task.task_id, task]));
  const linkedFollowups = new Set<string>();
  for (const call of input.calls) {
    if (call.user_id !== input.userId) continue;
    if (isSyntheticAuditCall(call)) continue;
    if (!isGenuineCallLog(call) || result.genuine_call_ids.has(call.log_id)) continue;
    result.genuine_call_ids.add(call.log_id);
    const task = tasksById.get(call.log_id);
    if (task && isFollowUpCompletionCall(call, task)) {
      result.followup_call_ids.add(call.log_id);
      const pair = reconcileFollowUpPair(call, task);
      if (pair.linked) linkedFollowups.add(task.task_id);
      else if (pair.warning) result.warnings.push({ source: "follow-up integrity", message: pair.warning });
    }
    result.unique_work_keys.add(linkedFollowups.has(call.log_id) ? buildUniqueWorkKey("followup", call.log_id) : buildUniqueWorkKey("call", call.log_id));
    result.latest_activity_at = maxTime(result.latest_activity_at, call.timestamp);
  }
  const completionByTask = new Map<string, CanonicalTaskHistory>();
  for (const history of input.taskHistory) {
    if (history.new_status.toLowerCase() !== "completed") continue;
    const existing = completionByTask.get(history.task_id);
    if (!existing || Date.parse(history.changed_at) > Date.parse(existing.changed_at)) completionByTask.set(history.task_id, history);
  }
  for (const task of input.tasks) {
    if (task.assigned_to !== input.userId) continue;
    const history = completionByTask.get(task.task_id);
    const completedAt = history?.changed_at ?? task.completed_at;
    if ((!history && task.status.toLowerCase() !== "completed") || !completedAt || result.completed_task_ids.has(task.task_id)) {
      if (!history && task.status.toLowerCase() !== "completed" && task.source === "manual" && task.template_id == null && FOLLOWUP_CONTRACT.test(task.description ?? "")) result.pending_followups += 1;
      continue;
    }
    if (history?.changed_by && history.changed_by !== task.assigned_to) result.warnings.push({ source: "task attribution", message: `Task ${task.task_id} was completed by a different audit actor; credit remains with assigned_to.` });
    result.completed_task_ids.add(task.task_id);
    const followup = FOLLOWUP_CONTRACT.test(task.description ?? "") && task.source === "manual" && task.template_id == null;
    if (followup) result.followup_task_ids.add(task.task_id);
    result.unique_work_keys.add(linkedFollowups.has(task.task_id) ? buildUniqueWorkKey("followup", task.task_id) : buildUniqueWorkKey("task", task.task_id));
    result.latest_activity_at = maxTime(result.latest_activity_at, completedAt);
  }
  for (const query of input.queries ?? []) if ((query.resolved_by ?? query.assigned_to) === input.userId && query.problem_status.toLowerCase() === "resolved" && query.resolved_at && !result.query_ids.has(query.query_id)) { result.query_ids.add(query.query_id); result.unique_work_keys.add(buildUniqueWorkKey("query", query.query_id)); result.latest_activity_at = maxTime(result.latest_activity_at, query.resolved_at); }
  for (const mapping of input.mappings ?? []) if (mapping.mapped_by === input.userId && ["completed", "resolved"].includes(mapping.status.toLowerCase()) && mapping.completed_at && !result.mapping_ids.has(mapping.request_id)) { result.mapping_ids.add(mapping.request_id); result.unique_work_keys.add(buildUniqueWorkKey("mapping", mapping.request_id)); result.latest_activity_at = maxTime(result.latest_activity_at, mapping.completed_at); }
  for (const target of input.targets ?? []) if (target.assigned_to_user_id === input.userId && target.is_completed && target.completed_at && !result.target_ids.has(target.target_id)) { result.target_ids.add(target.target_id); result.unique_work_keys.add(buildUniqueWorkKey("target", target.target_id)); result.latest_activity_at = maxTime(result.latest_activity_at, target.completed_at); }
  for (const call of input.calls) if (call.user_id === input.userId && !isSyntheticAuditCall(call) && AUDIT_LIKE_PATTERN.test(call.outcome ?? "") && !KNOWN_SYNTHETIC_PATTERNS.some((pattern) => pattern.test(call.outcome ?? ""))) result.warnings.push({ source: "call classification", message: `Call ${call.log_id} has an unknown audit-like outcome and was retained as a genuine call for review.` });
  return result;
}

export function getCanonicalDailyTeamMetrics(input: Omit<Parameters<typeof getCanonicalDailyUserMetrics>[0], "userId"> & { userIds: string[] }): CanonicalDailyUserMetrics[] {
  return [...new Set(input.userIds)].map((userId) => getCanonicalDailyUserMetrics({ ...input, userId }));
}
