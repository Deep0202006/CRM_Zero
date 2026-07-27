import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import {
  buildTeamKpiReport,
  type KpiAllocatedTargetRecord,
  type KpiCallRecord,
  type KpiCapabilityRecord,
  type KpiClientQueryRecord,
  type KpiMappingRecord,
  type KpiTaskHistoryRecord,
  type KpiTaskRecord,
  type KpiUserCapabilityRecord,
  type KpiUserRecord,
} from "./aggregate";
import type { TeamKpiResponse, TeamKpiSourceWarning } from "./contract";

const PAGE_SIZE = 1000;
const MAX_PAGES_PER_SOURCE = 100;
const UUID_CHUNK_SIZE = 200;

interface PageResult<T> {
  data: T[] | null;
  error: PostgrestError | null;
}

export class TeamKpiServerError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "TeamKpiServerError";
  }
}

function validateDateKey(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TeamKpiServerError("INVALID_DATE", "A valid KPI date is required.", 400);
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new TeamKpiServerError("INVALID_DATE", "The KPI date is not a real calendar date.", 400);
  }
  return value;
}

function addUtcCalendarDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day + days));
  return value.toISOString().slice(0, 10);
}

export function getIstDayBounds(dateKey: string): { startsAt: string; endsAt: string } {
  const validDate = validateDateKey(dateKey);
  const nextDate = addUtcCalendarDays(validDate, 1);
  return {
    startsAt: new Date(`${validDate}T00:00:00+05:30`).toISOString(),
    endsAt: new Date(`${nextDate}T00:00:00+05:30`).toISOString(),
  };
}

function conciseSourceMessage(source: string, error: PostgrestError): string {
  const code = error.code ? ` (${error.code})` : "";
  return `${source} could not be read${code}.`;
}

async function fetchAllPages<T>(
  source: string,
  loadPage: (from: number, to: number) => Promise<PageResult<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES_PER_SOURCE; page += 1) {
    const from = page * PAGE_SIZE;
    const result = await loadPage(from, from + PAGE_SIZE - 1);
    if (result.error) {
      throw new TeamKpiServerError(
        `SOURCE_${source.toUpperCase()}_FAILED`,
        conciseSourceMessage(source, result.error),
        502,
      );
    }
    const pageRows = result.data ?? [];
    rows.push(...pageRows);
    if (pageRows.length < PAGE_SIZE) return rows;
  }
  throw new TeamKpiServerError(
    `SOURCE_${source.toUpperCase()}_TOO_LARGE`,
    `${source} exceeded the safe reporting page limit.`,
    413,
  );
}

async function fetchOptionalSource<T>(
  source: string,
  warnings: TeamKpiSourceWarning[],
  loadPage: (from: number, to: number) => Promise<PageResult<T>>,
): Promise<T[]> {
  try {
    return await fetchAllPages(source, loadPage);
  } catch (error) {
    if (error instanceof TeamKpiServerError) {
      warnings.push({ source, message: error.message });
      return [];
    }
    throw error;
  }
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function fetchClientQueries(
  client: SupabaseClient,
  startsAt: string,
  endsAt: string,
  warnings: TeamKpiSourceWarning[],
): Promise<KpiClientQueryRecord[]> {
  try {
    return await fetchAllPages<KpiClientQueryRecord>("client queries", async (from, to) => {
      const result = await client
        .from("client_queries")
        .select("query_id,assigned_to,resolved_by,resolved_at,problem_status")
        .eq("problem_status", "Resolved")
        .gte("resolved_at", startsAt)
        .lt("resolved_at", endsAt)
        .order("resolved_at", { ascending: true })
        .range(from, to);
      return { data: result.data as KpiClientQueryRecord[] | null, error: result.error };
    });
  } catch (error) {
    const code = error instanceof TeamKpiServerError ? error.code : "";
    if (!code.includes("CLIENT QUERIES")) throw error;

    warnings.push({
      source: "client queries",
      message: "Client-query resolver attribution is unavailable; assigned-user attribution was used as a compatibility fallback.",
    });
    return fetchOptionalSource<KpiClientQueryRecord>("client queries compatibility", warnings, async (from, to) => {
      const result = await client
        .from("client_queries")
        .select("query_id,assigned_to,resolved_at,problem_status")
        .eq("problem_status", "Resolved")
        .gte("resolved_at", startsAt)
        .lt("resolved_at", endsAt)
        .order("resolved_at", { ascending: true })
        .range(from, to);
      return { data: result.data as KpiClientQueryRecord[] | null, error: result.error };
    });
  }
}

async function fetchTasksByIds(
  client: SupabaseClient,
  taskIds: string[],
  warnings: TeamKpiSourceWarning[],
): Promise<KpiTaskRecord[]> {
  const uniqueTaskIds = [...new Set(taskIds)];
  if (uniqueTaskIds.length === 0) return [];

  const rows: KpiTaskRecord[] = [];
  try {
    for (const taskIdChunk of chunks(uniqueTaskIds, UUID_CHUNK_SIZE)) {
      const response = await client
        .from("tasks")
        .select("task_id,assigned_to,completed_at,status")
        .in("task_id", taskIdChunk);
      if (response.error) {
        throw new TeamKpiServerError(
          "SOURCE_TASK_LOOKUP_FAILED",
          conciseSourceMessage("task attribution", response.error),
          502,
        );
      }
      rows.push(...((response.data ?? []) as KpiTaskRecord[]));
    }
  } catch (error) {
    warnings.push({
      source: "task attribution",
      message: error instanceof Error ? error.message : "Task attribution could not be checked.",
    });
  }
  return rows;
}

async function fetchTaskIdsWithCompletionHistory(
  client: SupabaseClient,
  taskIds: string[],
  warnings: TeamKpiSourceWarning[],
): Promise<Set<string>> {
  const result = new Set<string>();
  if (taskIds.length === 0) return result;

  try {
    for (const taskIdChunk of chunks([...new Set(taskIds)], UUID_CHUNK_SIZE)) {
      const response = await client
        .from("task_status_history")
        .select("task_id")
        .eq("new_status", "Completed")
        .in("task_id", taskIdChunk);
      if (response.error) {
        throw new TeamKpiServerError(
          "SOURCE_TASK_HISTORY_LOOKUP_FAILED",
          conciseSourceMessage("task completion history", response.error),
          502,
        );
      }
      for (const row of (response.data ?? []) as Array<{ task_id: string }>) result.add(row.task_id);
    }
  } catch (error) {
    warnings.push({
      source: "task completion history",
      message: error instanceof Error ? error.message : "Task completion history could not be checked.",
    });
  }
  return result;
}

export async function loadTeamKpiServerReport(
  client: SupabaseClient,
  targetDate: string,
): Promise<TeamKpiResponse> {
  const dateKey = validateDateKey(targetDate);
  const { startsAt, endsAt } = getIstDayBounds(dateKey);
  const warnings: TeamKpiSourceWarning[] = [];

  const users = await fetchAllPages<KpiUserRecord>("users", async (from, to) => {
    const result = await client
      .from("users")
      .select("user_id,name,is_active")
      .order("name", { ascending: true })
      .range(from, to);
    return { data: result.data as KpiUserRecord[] | null, error: result.error };
  });

  const [
    userCapabilities,
    capabilities,
    calls,
    clientQueries,
    mappings,
    tasks,
    taskHistory,
    allocatedTargets,
  ] = await Promise.all([
    fetchOptionalSource<KpiUserCapabilityRecord>("user capabilities", warnings, async (from, to) => {
      const result = await client
        .from("user_capabilities")
        .select("user_id,capability_code")
        .order("user_id", { ascending: true })
        .range(from, to);
      return { data: result.data as KpiUserCapabilityRecord[] | null, error: result.error };
    }),
    fetchOptionalSource<KpiCapabilityRecord>("capability labels", warnings, async (from, to) => {
      const result = await client
        .from("capabilities")
        .select("code,label")
        .order("code", { ascending: true })
        .range(from, to);
      return { data: result.data as KpiCapabilityRecord[] | null, error: result.error };
    }),
    fetchOptionalSource<KpiCallRecord>("calls", warnings, async (from, to) => {
      const result = await client
        .from("call_logs")
        .select("log_id,user_id,timestamp,outcome")
        .gte("timestamp", startsAt)
        .lt("timestamp", endsAt)
        .order("timestamp", { ascending: true })
        .range(from, to);
      return { data: result.data as KpiCallRecord[] | null, error: result.error };
    }),
    fetchClientQueries(client, startsAt, endsAt, warnings),
    fetchOptionalSource<KpiMappingRecord>("mappings", warnings, async (from, to) => {
      const result = await client
        .from("mapping_requests")
        .select("request_id,mapped_by,completed_at,status")
        .eq("status", "Completed")
        .gte("completed_at", startsAt)
        .lt("completed_at", endsAt)
        .order("completed_at", { ascending: true })
        .range(from, to);
      return { data: result.data as KpiMappingRecord[] | null, error: result.error };
    }),
    fetchOptionalSource<KpiTaskRecord>("tasks", warnings, async (from, to) => {
      const result = await client
        .from("tasks")
        .select("task_id,assigned_to,completed_at,status")
        .eq("status", "Completed")
        .gte("completed_at", startsAt)
        .lt("completed_at", endsAt)
        .order("completed_at", { ascending: true })
        .range(from, to);
      return { data: result.data as KpiTaskRecord[] | null, error: result.error };
    }),
    fetchOptionalSource<KpiTaskHistoryRecord>("task completion history", warnings, async (from, to) => {
      const result = await client
        .from("task_status_history")
        .select("id,task_id,changed_by,changed_at,new_status")
        .eq("new_status", "Completed")
        .gte("changed_at", startsAt)
        .lt("changed_at", endsAt)
        .order("changed_at", { ascending: true })
        .range(from, to);
      return { data: result.data as KpiTaskHistoryRecord[] | null, error: result.error };
    }),
    fetchOptionalSource<KpiAllocatedTargetRecord>("spreadsheet targets", warnings, async (from, to) => {
      const result = await client
        .from("allocated_targets")
        .select("target_id,assigned_to_user_id,completed_at,is_completed")
        .eq("is_completed", true)
        .gte("completed_at", startsAt)
        .lt("completed_at", endsAt)
        .order("completed_at", { ascending: true })
        .range(from, to);
      return { data: result.data as KpiAllocatedTargetRecord[] | null, error: result.error };
    }),
  ]);

  const historyTaskDetails = await fetchTasksByIds(
    client,
    taskHistory.map((event) => event.task_id),
    warnings,
  );
  const tasksById = new Map<string, KpiTaskRecord>();
  for (const task of [...tasks, ...historyTaskDetails]) tasksById.set(task.task_id, task);
  const allRelevantTasks = [...tasksById.values()];

  const taskIdsWithAnyCompletionHistory = await fetchTaskIdsWithCompletionHistory(
    client,
    tasks.map((task) => task.task_id),
    warnings,
  );
  for (const event of taskHistory) taskIdsWithAnyCompletionHistory.add(event.task_id);

  return buildTeamKpiReport({
    targetDate: dateKey,
    users,
    userCapabilities,
    capabilities,
    calls,
    clientQueries,
    mappings,
    tasks: allRelevantTasks,
    taskHistory,
    taskIdsWithAnyCompletionHistory,
    allocatedTargets,
    warnings,
    source: "server-aggregation",
  });
}
