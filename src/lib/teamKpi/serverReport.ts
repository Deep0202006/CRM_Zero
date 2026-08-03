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

interface SourceVariant<T> {
  name: string;
  loadPage: (from: number, to: number) => Promise<PageResult<T>>;
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

function isCompatibilityError(error: PostgrestError): boolean {
  return (
    ["42703", "42P01", "PGRST200", "PGRST204", "PGRST205"].includes(error.code ?? "") ||
    /column .* does not exist|relation .* does not exist|could not find .* column|schema cache/i.test(error.message ?? "")
  );
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
      throw Object.assign(new Error(conciseSourceMessage(source, result.error)), {
        source,
        postgrestError: result.error,
      });
    }
    const pageRows = result.data ?? [];
    rows.push(...pageRows);
    if (pageRows.length < PAGE_SIZE) return rows;
  }
  throw new TeamKpiServerError(
    `SOURCE_${source.toUpperCase().replace(/\W+/g, "_")}_TOO_LARGE`,
    `${source} exceeded the safe reporting page limit.`,
    413,
  );
}

async function fetchRequiredSource<T>(
  source: string,
  loadPage: (from: number, to: number) => Promise<PageResult<T>>,
): Promise<T[]> {
  try {
    return await fetchAllPages(source, loadPage);
  } catch (error) {
    if (error instanceof TeamKpiServerError) throw error;
    const candidate = error as { postgrestError?: PostgrestError };
    throw new TeamKpiServerError(
      `SOURCE_${source.toUpperCase().replace(/\W+/g, "_")}_FAILED`,
      candidate.postgrestError
        ? conciseSourceMessage(source, candidate.postgrestError)
        : `${source} could not be read.`,
      502,
    );
  }
}

async function fetchCompatibleSource<T>(
  source: string,
  warnings: TeamKpiSourceWarning[],
  variants: SourceVariant<T>[],
): Promise<T[]> {
  let lastError: PostgrestError | null = null;

  for (let index = 0; index < variants.length; index += 1) {
    const variant = variants[index];
    try {
      const rows = await fetchAllPages(`${source} (${variant.name})`, variant.loadPage);
      if (index > 0) {
        warnings.push({
          source,
          message: `${source} is using the compatible ${variant.name} data contract.`,
        });
      }
      return rows;
    } catch (error) {
      if (error instanceof TeamKpiServerError) throw error;
      const candidate = error as { postgrestError?: PostgrestError };
      const postgrestError = candidate.postgrestError;
      if (!postgrestError) throw error;
      lastError = postgrestError;
      if (isCompatibilityError(postgrestError) && index < variants.length - 1) continue;
      warnings.push({ source, message: conciseSourceMessage(source, postgrestError) });
      return [];
    }
  }

  if (lastError) warnings.push({ source, message: conciseSourceMessage(source, lastError) });
  return [];
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function fetchTaskRowsByIds(
  client: SupabaseClient,
  taskIds: string[],
  warnings: TeamKpiSourceWarning[],
): Promise<KpiTaskRecord[]> {
  const uniqueTaskIds = [...new Set(taskIds)];
  if (uniqueTaskIds.length === 0) return [];

  const rows: KpiTaskRecord[] = [];
  for (const taskIdChunk of chunks(uniqueTaskIds, UUID_CHUNK_SIZE)) {
    const response = await client
      .from("tasks")
      .select("task_id,assigned_to,assigned_by,completed_at,status,source,template_id,description")
      .in("task_id", taskIdChunk);
    if (response.error) {
      warnings.push({ source: "task attribution", message: conciseSourceMessage("task attribution", response.error) });
      return rows;
    }
    rows.push(...((response.data ?? []) as KpiTaskRecord[]));
  }
  return rows;
}

async function fetchTaskIdsWithAnyCompletionHistory(
  client: SupabaseClient,
  taskIds: string[],
  warnings: TeamKpiSourceWarning[],
): Promise<Set<string>> {
  const result = new Set<string>();
  const uniqueTaskIds = [...new Set(taskIds)];
  if (uniqueTaskIds.length === 0) return result;

  for (const taskIdChunk of chunks(uniqueTaskIds, UUID_CHUNK_SIZE)) {
    const response = await client
      .from("task_status_history")
      .select("task_id")
      .eq("new_status", "Completed")
      .in("task_id", taskIdChunk);
    if (response.error) {
      warnings.push({
        source: "task completion history",
        message: conciseSourceMessage("task completion history", response.error),
      });
      return result;
    }
    for (const row of (response.data ?? []) as Array<{ task_id: string }>) result.add(row.task_id);
  }
  return result;
}

export async function loadTeamKpiServerReport(
  client: SupabaseClient,
  targetDate: string,
  initialWarnings: TeamKpiSourceWarning[] = [],
): Promise<TeamKpiResponse> {
  const dateKey = validateDateKey(targetDate);
  const { startsAt, endsAt } = getIstDayBounds(dateKey);
  const warnings = [...initialWarnings];

  const users = await fetchRequiredSource<KpiUserRecord>("users", async (from, to) => {
    const result = await client
      .from("users")
      .select("user_id,name,is_active")
      .order("name", { ascending: true })
      .range(from, to);
    return { data: result.data as KpiUserRecord[] | null, error: result.error };
  });

  const [userCapabilities, capabilities, calls, clientQueries, mappingRequests, legacyMappings, tasks, taskHistory, allocatedTargets] = await Promise.all([
    fetchCompatibleSource<KpiUserCapabilityRecord>("user capabilities", warnings, [{
      name: "canonical",
      loadPage: async (from, to) => {
        const result = await client
          .from("user_capabilities")
          .select("user_id,capability_code")
          .order("user_id", { ascending: true })
          .range(from, to);
        return { data: result.data as KpiUserCapabilityRecord[] | null, error: result.error };
      },
    }]),
    fetchCompatibleSource<KpiCapabilityRecord>("capability labels", warnings, [{
      name: "canonical",
      loadPage: async (from, to) => {
        const result = await client
          .from("capabilities")
          .select("code,label")
          .order("code", { ascending: true })
          .range(from, to);
        return { data: result.data as KpiCapabilityRecord[] | null, error: result.error };
      },
    }]),
    fetchCompatibleSource<KpiCallRecord>("calls", warnings, [{
      name: "canonical",
      loadPage: async (from, to) => {
        const result = await client
          .from("call_logs")
          .select("log_id,user_id,timestamp,outcome,next_followup_date")
          .gte("timestamp", startsAt)
          .lt("timestamp", endsAt)
          .order("timestamp", { ascending: true })
          .range(from, to);
        return { data: result.data as KpiCallRecord[] | null, error: result.error };
      },
    }]),
    fetchCompatibleSource<KpiClientQueryRecord>("client queries", warnings, [
      {
        name: "resolver attribution",
        loadPage: async (from, to) => {
          const result = await client
            .from("client_queries")
            .select("query_id,assigned_to,resolved_by,resolved_at,problem_status")
            .eq("problem_status", "Resolved")
            .gte("resolved_at", startsAt)
            .lt("resolved_at", endsAt)
            .order("resolved_at", { ascending: true })
            .range(from, to);
          return { data: result.data as KpiClientQueryRecord[] | null, error: result.error };
        },
      },
      {
        name: "assigned-user attribution",
        loadPage: async (from, to) => {
          const result = await client
            .from("client_queries")
            .select("query_id,assigned_to,resolved_at,problem_status")
            .eq("problem_status", "Resolved")
            .gte("resolved_at", startsAt)
            .lt("resolved_at", endsAt)
            .order("resolved_at", { ascending: true })
            .range(from, to);
          return { data: result.data as KpiClientQueryRecord[] | null, error: result.error };
        },
      },
    ]),
    fetchCompatibleSource<KpiMappingRecord>("mapping requests", warnings, [
      {
        name: "completed mapping request",
        loadPage: async (from, to) => {
          const result = await client
            .from("mapping_requests")
            .select("request_id,mapped_by,completed_at,status")
            .in("status", ["Completed", "Resolved"])
            .gte("completed_at", startsAt)
            .lt("completed_at", endsAt)
            .order("completed_at", { ascending: true })
            .range(from, to);
          return { data: result.data as KpiMappingRecord[] | null, error: result.error };
        },
      },
      {
        name: "legacy assigned mapping request",
        loadPage: async (from, to) => {
          const result = await client
            .from("mapping_requests")
            .select("request_id,assigned_to_id,updated_at,status")
            .in("status", ["Completed", "Resolved"])
            .gte("updated_at", startsAt)
            .lt("updated_at", endsAt)
            .order("updated_at", { ascending: true })
            .range(from, to);
          const data = (result.data ?? []).map((row) => {
            const legacy = row as unknown as { request_id: string; assigned_to_id: string | null; updated_at: string | null; status: string };
            return {
              request_id: `request:${legacy.request_id}`,
              mapped_by: legacy.assigned_to_id,
              completed_at: legacy.updated_at,
              status: legacy.status,
            } satisfies KpiMappingRecord;
          });
          return { data, error: result.error };
        },
      },
    ]),
    fetchCompatibleSource<KpiMappingRecord>("historical mappings", warnings, [{
      name: "mapping completion table",
      loadPage: async (from, to) => {
        const result = await client
          .from("mappings")
          .select("mapping_id,mapped_by,completion_timestamp")
          .gte("completion_timestamp", startsAt)
          .lt("completion_timestamp", endsAt)
          .order("completion_timestamp", { ascending: true })
          .range(from, to);
        const data = (result.data ?? []).map((row) => {
          const mapping = row as unknown as { mapping_id: string; mapped_by: string | null; completion_timestamp: string | null };
          return {
            request_id: `mapping:${mapping.mapping_id}`,
            mapped_by: mapping.mapped_by,
            completed_at: mapping.completion_timestamp,
            status: "Completed",
          } satisfies KpiMappingRecord;
        });
        return { data, error: result.error };
      },
    }]),
    fetchCompatibleSource<KpiTaskRecord>("tasks", warnings, [{
      name: "completed task row",
      loadPage: async (from, to) => {
        const result = await client
          .from("tasks")
          .select("task_id,assigned_to,assigned_by,completed_at,status,source,template_id,description")
          .eq("status", "Completed")
          .gte("completed_at", startsAt)
          .lt("completed_at", endsAt)
          .order("completed_at", { ascending: true })
          .range(from, to);
        return { data: result.data as KpiTaskRecord[] | null, error: result.error };
      },
    }]),
    fetchCompatibleSource<KpiTaskHistoryRecord>("task completion history", warnings, [{
      name: "completion event",
      loadPage: async (from, to) => {
        const result = await client
          .from("task_status_history")
          .select("id,task_id,changed_by,changed_at,new_status")
          .eq("new_status", "Completed")
          .gte("changed_at", startsAt)
          .lt("changed_at", endsAt)
          .order("changed_at", { ascending: true })
          .range(from, to);
        return { data: result.data as KpiTaskHistoryRecord[] | null, error: result.error };
      },
    }]),
    fetchCompatibleSource<KpiAllocatedTargetRecord>("spreadsheet targets", warnings, [{
      name: "completed allocated target",
      loadPage: async (from, to) => {
        const result = await client
          .from("allocated_targets")
          .select("target_id,assigned_to_user_id,completed_at,is_completed")
          .eq("is_completed", true)
          .gte("completed_at", startsAt)
          .lt("completed_at", endsAt)
          .order("completed_at", { ascending: true })
          .range(from, to);
        return { data: result.data as KpiAllocatedTargetRecord[] | null, error: result.error };
      },
    }]),
  ]);

  const historyTaskDetails = await fetchTaskRowsByIds(
    client,
    taskHistory.map((event) => event.task_id),
    warnings,
  );
  const tasksById = new Map<string, KpiTaskRecord>();
  for (const task of [...tasks, ...historyTaskDetails]) tasksById.set(task.task_id, task);
  const allRelevantTasks = [...tasksById.values()];

  const taskIdsWithAnyCompletionHistory = await fetchTaskIdsWithAnyCompletionHistory(
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
    mappings: [...mappingRequests, ...legacyMappings],
    tasks: allRelevantTasks,
    taskHistory,
    taskIdsWithAnyCompletionHistory,
    allocatedTargets,
    warnings,
    source: "server-aggregation",
  });
}
