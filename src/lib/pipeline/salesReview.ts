import { addISTDateDays, getISTDateKey } from "@/lib/dateTime";
import { PIPELINE_STAGES, type PipelineStage } from "@/lib/pipelineStages";

export type MovementDirection = "advanced" | "regressed" | "cycle" | "neutral";
export type AttentionReasonCode = "STALE_STAGE" | "OVERDUE_TASK" | "CHANGED_TODAY" | "CHANGED_RECENTLY" | "ADVANCED" | "REGRESSED" | "NO_EXACT_NEXT_TASK";
export type FocusPriority = "P0" | "P1" | "P2";

export type PipelineTransitionFact = {
  lead_id: string;
  expected_stage: string;
  target_stage: string;
  confirmed_at: string;
};

export async function pipelineTaskIdFor(userId: string, leadId: string, dueDate: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`zerodata:pipeline-task:v1:${userId}:${leadId}:${dueDate}`)));
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = [...digest.slice(0, 16)].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const ADVANCEMENTS = new Set([
  "New>Contacted", "Contacted>Interested", "Not Interested>Contacted",
  "Interested>Registration", "Registration>Installation", "Installation>Payment",
  "Installation>Converted", "Renewal Due>Payment", "Renewal Due>Converted",
]);
const REGRESSIONS = new Set(["Contacted>Not Interested", "Renewal Due>Not Interested"]);
const CYCLES = new Set(["Payment>Renewal Due"]);

export function movementDirection(from: string, to: string): MovementDirection {
  const key = `${from}>${to}`;
  if (ADVANCEMENTS.has(key)) return "advanced";
  if (REGRESSIONS.has(key)) return "regressed";
  if (CYCLES.has(key)) return "cycle";
  return "neutral";
}

export function orderedStageCounts(rows: Array<{ status: string; lead_count: number }>) {
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.status, (totals.get(row.status) ?? 0) + Number(row.lead_count || 0));
  return PIPELINE_STAGES.map((stage) => ({ stage, count: totals.get(stage) ?? 0 }));
}

export function currentStageAgeRows(
  ages: Array<{ status: string; segment_type: string; avg_days_in_current_stage: number }>,
  counts: Array<{ status: string; segment_type: string; lead_count: number }>,
) {
  const countBySegmentStage = new Map(counts.map((row) => [`${row.segment_type}:${row.status}`, Number(row.lead_count) || 0]));
  const totals = new Map<string, { weightedDays: number; count: number }>();
  for (const row of ages) {
    const count = countBySegmentStage.get(`${row.segment_type}:${row.status}`) ?? 0;
    const days = Number(row.avg_days_in_current_stage);
    if (!count || !Number.isFinite(days)) continue;
    const current = totals.get(row.status) ?? { weightedDays: 0, count: 0 };
    totals.set(row.status, { weightedDays: current.weightedDays + days * count, count: current.count + count });
  }
  return PIPELINE_STAGES.flatMap((stage) => {
    const total = totals.get(stage);
    return total?.count ? [{ stage, average_days: Math.round(total.weightedDays / total.count * 10) / 10, sample_n: total.count }] : [];
  });
}

export function sanitizePipelineSearch(value: string | null): string {
  return (value ?? "").normalize("NFKC").replace(/[,()%]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

export function canReadLinkedWork(isAdmin: boolean, viewerId: string, ownerId: string | null | undefined): boolean {
  return isAdmin || Boolean(ownerId && ownerId === viewerId);
}

export function attentionReasons(input: {
  stageAgeDays: number;
  today: string;
  nextTaskDueDate?: string | null;
  latestTransition?: PipelineTransitionFact | null;
}) {
  const reasons: Array<{ code: AttentionReasonCode; text: string }> = [];
  if (input.stageAgeDays >= 14) reasons.push({ code: "STALE_STAGE", text: `Current stage is ${input.stageAgeDays} days old` });
  if (input.nextTaskDueDate && input.nextTaskDueDate < input.today) reasons.push({ code: "OVERDUE_TASK", text: `Exact linked task was due ${input.nextTaskDueDate}` });
  if (!input.nextTaskDueDate) reasons.push({ code: "NO_EXACT_NEXT_TASK", text: "No exact linked next task" });
  const transition = input.latestTransition;
  if (transition) {
    const changed = getISTDateKey(transition.confirmed_at);
    if (changed === input.today) reasons.push({ code: "CHANGED_TODAY", text: "Stage changed today" });
    else if (changed >= addISTDateDays(input.today, -6)) reasons.push({ code: "CHANGED_RECENTLY", text: `Stage changed on ${changed}` });
    const direction = movementDirection(transition.expected_stage, transition.target_stage);
    if (direction === "advanced") reasons.push({ code: "ADVANCED", text: `${transition.expected_stage} advanced to ${transition.target_stage}` });
    if (direction === "regressed") reasons.push({ code: "REGRESSED", text: `${transition.expected_stage} regressed to ${transition.target_stage}` });
  }
  return reasons;
}

function median(values: number[]) {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

export function completedStageVelocity(transitions: PipelineTransitionFact[], leadCreatedAt: Map<string, string>) {
  const byLead = new Map<string, PipelineTransitionFact[]>();
  for (const row of transitions) byLead.set(row.lead_id, [...(byLead.get(row.lead_id) ?? []), row]);
  const durations = new Map<PipelineStage, number[]>();
  let eligible = 0;
  for (const [leadId, rows] of byLead) {
    rows.sort((left, right) => left.confirmed_at.localeCompare(right.confirmed_at));
    let enteredAt = leadCreatedAt.get(leadId) ?? null;
    let enteredStage = "New";
    for (const row of rows) {
      if (enteredAt && row.expected_stage === enteredStage && PIPELINE_STAGES.includes(row.expected_stage as PipelineStage)) {
        eligible += 1;
        const days = (Date.parse(row.confirmed_at) - Date.parse(enteredAt)) / 86_400_000;
        if (Number.isFinite(days) && days >= 0) durations.set(row.expected_stage as PipelineStage, [...(durations.get(row.expected_stage as PipelineStage) ?? []), days]);
      }
      enteredAt = row.confirmed_at;
      enteredStage = row.target_stage;
    }
  }
  const sampleN = [...durations.values()].reduce((sum, values) => sum + values.length, 0);
  return {
    rows: PIPELINE_STAGES.flatMap((stage) => {
      const values = durations.get(stage) ?? [];
      if (!values.length) return [];
      return [{ stage, p50_days: Math.round(median(values) * 10) / 10, average_days: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10, sample_n: values.length }];
    }),
    sample_n: sampleN,
    coverage_n: eligible,
    coverage_pct: eligible ? Math.round(sampleN / eligible * 1000) / 10 : 0,
  };
}

function weekStart(date: string) {
  const weekday = new Date(`${date}T12:00:00+05:30`).getUTCDay();
  return addISTDateDays(date, -((weekday + 6) % 7));
}

function monthOffset(month: string, offset: number) {
  const [year, value] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, value - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type SalesHistoryLead = { lead_id: string; created_at: string };
export type SalesHistoryPoint = { period: string; new_leads: number; successes: number; movements: number; advanced: number; regressed: number };

export function buildSalesHistory(leads: SalesHistoryLead[], transitions: PipelineTransitionFact[], today: string, window: "weeks" | "months"): SalesHistoryPoint[] {
  const keys = window === "weeks"
    ? Array.from({ length: 12 }, (_, index) => addISTDateDays(weekStart(today), (index - 11) * 7))
    : Array.from({ length: 12 }, (_, index) => monthOffset(today.slice(0, 7), index - 11));
  const points = new Map(keys.map((period) => [period, { period, new_leads: 0, successes: 0, movements: 0, advanced: 0, regressed: 0 }]));
  const keyFor = (timestamp: string) => {
    const date = getISTDateKey(timestamp);
    return window === "weeks" ? weekStart(date) : date.slice(0, 7);
  };
  for (const lead of leads) {
    const point = points.get(keyFor(lead.created_at));
    if (point) point.new_leads += 1;
  }
  for (const transition of transitions) {
    const point = points.get(keyFor(transition.confirmed_at));
    if (!point) continue;
    point.movements += 1;
    const direction = movementDirection(transition.expected_stage, transition.target_stage);
    if (direction === "advanced") point.advanced += 1;
    if (direction === "regressed") point.regressed += 1;
    if (transition.target_stage === "Converted" || (transition.expected_stage === "Installation" && transition.target_stage === "Payment")) point.successes += 1;
  }
  return keys.map((key) => points.get(key)!);
}

export function sourceConversionRows(rows: Array<{ lead_source: string; total_leads: number; converted: number }>) {
  const grouped = new Map<string, { total: number; converted: number }>();
  for (const row of rows) {
    const current = grouped.get(row.lead_source) ?? { total: 0, converted: 0 };
    grouped.set(row.lead_source, { total: current.total + Number(row.total_leads || 0), converted: current.converted + Number(row.converted || 0) });
  }
  return [...grouped].map(([source, value]) => ({ source, ...value, rate: value.total ? Math.round(value.converted / value.total * 1000) / 10 : 0, reconciled: value.converted >= 0 && value.converted <= value.total })).sort((left, right) => right.rate - left.rate || right.total - left.total || left.source.localeCompare(right.source));
}

export function classifyTaskFocus(task: { status: string; due_date: string; priority?: string }, today: string, exactFollowUp: boolean): { priority: FocusPriority; reason_code: string; reason: string } {
  if (task.status === "Missed") return { priority: "P0", reason_code: "MISSED_TASK", reason: "Missed task" };
  if (task.due_date < today) return { priority: "P0", reason_code: "OVERDUE_TASK", reason: `Overdue since ${task.due_date}` };
  if (task.due_date === today && exactFollowUp) return { priority: "P0", reason_code: "FOLLOWUP_DUE_TODAY", reason: "Exact follow-up due today" };
  if (task.due_date <= addISTDateDays(today, 1)) return { priority: "P1", reason_code: task.due_date === today ? "TASK_DUE_TODAY" : "TASK_DUE_SOON", reason: task.due_date === today ? "Task due today" : "Task due tomorrow" };
  if (task.priority === "High") return { priority: "P1", reason_code: "HIGH_PRIORITY_TASK", reason: "High-priority next action" };
  return { priority: "P2", reason_code: "SCHEDULED_TASK", reason: `Scheduled for ${task.due_date}` };
}
