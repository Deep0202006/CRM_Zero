import { z } from "zod";

const nonNegativeInteger = z.coerce.number().int().nonnegative();

export const teamKpiSourceWarningSchema = z.object({
  source: z.string().min(1),
  message: z.string().min(1),
});

export const teamKpiRowSchema = z.object({
  user_id: z.string().uuid(),
  name: z.string().min(1),
  role: z.string().min(1).default("Team member"),
  capabilities: z.array(z.string()).default([]),
  calls_made: nonNegativeInteger,
  queries_handled: nonNegativeInteger,
  mappings_completed: nonNegativeInteger,
  tasks_completed: nonNegativeInteger,
  total_completed_work: nonNegativeInteger,
  latest_activity_time: z.string().datetime({ offset: true }).nullable(),
}).superRefine((row, context) => {
  const expectedTotal = row.calls_made + row.queries_handled + row.mappings_completed + row.tasks_completed;
  if (row.total_completed_work !== expectedTotal) {
    context.addIssue({
      code: "custom",
      path: ["total_completed_work"],
      message: "Team KPI row total does not match its metric components.",
    });
  }
});

export const teamKpiTotalsSchema = z.object({
  team_members: nonNegativeInteger,
  calls_made: nonNegativeInteger,
  queries_handled: nonNegativeInteger,
  mappings_completed: nonNegativeInteger,
  tasks_completed: nonNegativeInteger,
  total_completed_work: nonNegativeInteger,
});

export const teamKpiResponseSchema = z.object({
  target_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  generated_at: z.string().datetime({ offset: true }),
  rows: z.array(teamKpiRowSchema),
  totals: teamKpiTotalsSchema,
  source: z.enum(["server-aggregation", "database-rpc"]).default("server-aggregation"),
  warnings: z.array(teamKpiSourceWarningSchema).default([]),
}).superRefine((report, context) => {
  const expectedTotals = report.rows.reduce(
    (totals, row) => ({
      team_members: totals.team_members + 1,
      calls_made: totals.calls_made + row.calls_made,
      queries_handled: totals.queries_handled + row.queries_handled,
      mappings_completed: totals.mappings_completed + row.mappings_completed,
      tasks_completed: totals.tasks_completed + row.tasks_completed,
      total_completed_work: totals.total_completed_work + row.total_completed_work,
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

  for (const [key, expected] of Object.entries(expectedTotals)) {
    const actual = report.totals[key as keyof typeof report.totals];
    if (actual !== expected) {
      context.addIssue({
        code: "custom",
        path: ["totals", key],
        message: `Team KPI total ${key} does not match the report rows.`,
      });
    }
  }
});

export type TeamKpiRow = z.infer<typeof teamKpiRowSchema>;
export type TeamKpiTotals = z.infer<typeof teamKpiTotalsSchema>;
export type TeamKpiResponse = z.infer<typeof teamKpiResponseSchema>;
export type TeamKpiSourceWarning = z.infer<typeof teamKpiSourceWarningSchema>;

export const EMPTY_TEAM_KPI_TOTALS: TeamKpiTotals = {
  team_members: 0,
  calls_made: 0,
  queries_handled: 0,
  mappings_completed: 0,
  tasks_completed: 0,
  total_completed_work: 0,
};

export function parseTeamKpiResponse(value: unknown): TeamKpiResponse {
  const parsed = teamKpiResponseSchema.parse(value);

  return {
    ...parsed,
    rows: [...parsed.rows].sort(
      (a, b) =>
        b.total_completed_work - a.total_completed_work ||
        a.name.localeCompare(b.name) ||
        a.user_id.localeCompare(b.user_id),
    ),
  };
}

interface SupabaseLikeError {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

export function getTeamKpiErrorMessage(error: unknown): string {
  const candidate = (error ?? {}) as SupabaseLikeError;
  const code = candidate.code ?? "";
  const message = candidate.message ?? "";

  if (code === "AUTHENTICATION_REQUIRED" || code === "28000") {
    return "Your session has expired. Sign in again to refresh Team KPI.";
  }

  if (code === "42883" || code === "PGRST202" || (/get_team_kpi_daily/i.test(message) && /not found|schema cache/i.test(message))) {
    return "The database KPI function is not installed or unavailable. The server fallback will be used after the application is redeployed.";
  }

  if (code === "42501" || code === "ADMIN_REQUIRED" || code === "AUTHORIZATION_CHECK_FAILED" || /administrator access|required|unauthorized/i.test(message)) {
    return "Your account is not authorized to view team performance data.";
  }

  if (code.startsWith("SOURCE_USERS_")) {
    return "Team KPI could not read the active user directory. Check administrator RLS access and retry.";
  }

  if (/network|fetch|timeout|connection/i.test(message)) {
    return "Team KPI could not refresh because the connection was interrupted. Your last loaded report remains unchanged.";
  }

  return "Team KPI could not load confirmed work data. Retry, and check the browser console for the sanitized technical error.";
}
