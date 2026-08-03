import { buildTeamKpiReport } from "../teamKpi/aggregate";
import { getIstDayBounds } from "../teamKpi/serverReport";

describe("Team KPI live server aggregation", () => {
  it("keeps every active user, attributes confirmed work, and deduplicates records", () => {
    const report = buildTeamKpiReport({
      targetDate: "2026-07-27",
      generatedAt: "2026-07-27T12:00:00.000Z",
      users: [
        { user_id: "00000000-0000-4000-8000-000000000001", name: "User A", is_active: true },
        { user_id: "00000000-0000-4000-8000-000000000002", name: "User B", is_active: 1 },
        { user_id: "00000000-0000-4000-8000-000000000003", name: "Inactive", is_active: false },
      ],
      userCapabilities: [
        { user_id: "00000000-0000-4000-8000-000000000001", capability_code: "ret_support" },
      ],
      capabilities: [{ code: "ret_support", label: "Retail Support" }],
      calls: [
        { log_id: "call-1", user_id: "00000000-0000-4000-8000-000000000001", timestamp: "2026-07-27T04:00:00.000Z", outcome: "Happy call" },
        { log_id: "call-1", user_id: "00000000-0000-4000-8000-000000000001", timestamp: "2026-07-27T04:00:00.000Z", outcome: "Happy call" },
        { log_id: "call-2", user_id: "00000000-0000-4000-8000-000000000001", timestamp: "2026-07-27T05:00:00.000Z", outcome: "[Call outcome] → Contacted" },
      ],
      clientQueries: [
        { query_id: "query-1", assigned_to: "00000000-0000-4000-8000-000000000002", resolved_by: "00000000-0000-4000-8000-000000000001", resolved_at: "2026-07-27T06:00:00.000Z", problem_status: "Resolved" },
      ],
      mappings: [
        { request_id: "map-1", mapped_by: "00000000-0000-4000-8000-000000000001", completed_at: "2026-07-27T07:00:00.000Z", status: "Completed" },
      ],
      tasks: [
        { task_id: "task-1", assigned_to: "00000000-0000-4000-8000-000000000002", completed_at: "2026-07-27T08:00:00.000Z", status: "Completed" },
        { task_id: "task-2", assigned_to: "00000000-0000-4000-8000-000000000002", completed_at: "2026-07-27T09:00:00.000Z", status: "Completed" },
      ],
      taskHistory: [
        { id: "history-1", task_id: "task-1", changed_by: "00000000-0000-4000-8000-000000000001", changed_at: "2026-07-27T08:00:00.000Z", new_status: "Completed" },
        { id: "history-2", task_id: "task-1", changed_by: "00000000-0000-4000-8000-000000000001", changed_at: "2026-07-27T08:01:00.000Z", new_status: "Completed" },
      ],
      taskIdsWithAnyCompletionHistory: new Set(["task-1"]),
      allocatedTargets: [
        { target_id: "target-1", assigned_to_user_id: "00000000-0000-4000-8000-000000000001", completed_at: "2026-07-27T10:00:00.000Z", is_completed: true },
      ],
    });

    expect(report.rows).toHaveLength(2);
    expect(report.rows[0]).toMatchObject({
      name: "User A",
      role: "Retail Support",
      calls_made: 1,
      queries_handled: 1,
      mappings_completed: 1,
      tasks_completed: 1,
      total_completed_work: 4,
      latest_activity_time: "2026-07-27T10:00:00.000Z",
    });
    expect(report.rows[1]).toMatchObject({
      name: "User B",
      calls_made: 0,
      queries_handled: 0,
      mappings_completed: 0,
      tasks_completed: 2,
      total_completed_work: 2,
    });
    expect(report.totals).toEqual({
      team_members: 2,
      calls_made: 1,
      queries_handled: 1,
      mappings_completed: 1,
      tasks_completed: 3,
      total_completed_work: 6,
    });
  });

  it("uses the assigned user as a legacy query resolver fallback", () => {
    const report = buildTeamKpiReport({
      targetDate: "2026-07-27",
      users: [{ user_id: "00000000-0000-4000-8000-000000000001", name: "User A", is_active: "true" }],
      userCapabilities: [],
      capabilities: [],
      calls: [],
      clientQueries: [{ query_id: "query-1", assigned_to: "00000000-0000-4000-8000-000000000001", resolved_at: "2026-07-27T06:00:00.000Z", problem_status: "Resolved" }],
      mappings: [],
      tasks: [],
      taskHistory: [],
      allocatedTargets: [],
    });
    expect(report.rows[0].queries_handled).toBe(1);
  });

  it("credits a completion-history event to the assigned user when the event actor is unavailable", () => {
    const userId = "00000000-0000-4000-8000-000000000001";
    const report = buildTeamKpiReport({
      targetDate: "2026-07-27",
      users: [{ user_id: userId, name: "User A", is_active: true }],
      userCapabilities: [],
      capabilities: [],
      calls: [],
      clientQueries: [],
      mappings: [],
      tasks: [{ task_id: "task-reopened", assigned_to: userId, completed_at: null, status: "Pending" }],
      taskHistory: [{ id: "history-reopened", task_id: "task-reopened", changed_by: null, changed_at: "2026-07-27T08:00:00.000Z", new_status: "Completed" }],
      allocatedTargets: [],
    });

    expect(report.rows[0].tasks_completed).toBe(1);
    expect(report.rows[0].latest_activity_time).toBe("2026-07-27T08:00:00.000Z");
  });

  it("calculates exact Asia/Kolkata half-open day boundaries", () => {
    expect(getIstDayBounds("2026-07-27")).toEqual({
      startsAt: "2026-07-26T18:30:00.000Z",
      endsAt: "2026-07-27T18:30:00.000Z",
    });
  });
});
