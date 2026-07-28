import {
  getTeamKpiErrorMessage,
  parseTeamKpiResponse,
} from "../teamKpi/contract";

describe("Team KPI response contract", () => {
  it("coerces database counts, preserves zero-activity users, and sorts deterministically", () => {
    const response = parseTeamKpiResponse({
      target_date: "2026-07-27",
      generated_at: "2026-07-27T10:00:00+00:00",
      rows: [
        {
          user_id: "00000000-0000-4000-8000-000000000002",
          name: "Zero Work",
          role: "Field Retail",
          capabilities: ["field_ret"],
          calls_made: "0",
          queries_handled: 0,
          mappings_completed: 0,
          tasks_completed: 0,
          total_completed_work: 0,
          latest_activity_time: null,
        },
        {
          user_id: "00000000-0000-4000-8000-000000000001",
          name: "Active User",
          role: "Retailer Support",
          capabilities: ["ret_support"],
          calls_made: "2",
          queries_handled: "1",
          mappings_completed: 0,
          tasks_completed: 3,
          total_completed_work: "6",
          latest_activity_time: "2026-07-27T09:30:00+00:00",
        },
      ],
      totals: {
        team_members: "2",
        calls_made: "2",
        queries_handled: 1,
        mappings_completed: 0,
        tasks_completed: 3,
        total_completed_work: 6,
      },
    });

    expect(response.rows.map((row) => row.name)).toEqual(["Active User", "Zero Work"]);
    expect(response.rows[0].total_completed_work).toBe(6);
    expect(response.rows[1].total_completed_work).toBe(0);
    expect(response.totals.team_members).toBe(2);
  });


  it("rejects row totals that do not equal their metric components", () => {
    expect(() => parseTeamKpiResponse({
      target_date: "2026-07-27",
      generated_at: "2026-07-27T10:00:00+00:00",
      rows: [{
        user_id: "00000000-0000-4000-8000-000000000001",
        name: "Mismatch",
        role: "Team member",
        capabilities: [],
        calls_made: 1,
        queries_handled: 1,
        mappings_completed: 1,
        tasks_completed: 1,
        total_completed_work: 3,
        latest_activity_time: null,
      }],
      totals: {
        team_members: 1,
        calls_made: 1,
        queries_handled: 1,
        mappings_completed: 1,
        tasks_completed: 1,
        total_completed_work: 3,
      },
    })).toThrow();
  });

  it("rejects summary totals that do not equal the returned rows", () => {
    expect(() => parseTeamKpiResponse({
      target_date: "2026-07-27",
      generated_at: "2026-07-27T10:00:00+00:00",
      rows: [],
      totals: {
        team_members: 1,
        calls_made: 0,
        queries_handled: 0,
        mappings_completed: 0,
        tasks_completed: 0,
        total_completed_work: 0,
      },
    })).toThrow();
  });

  it("rejects negative work counts", () => {
    expect(() => parseTeamKpiResponse({
      target_date: "2026-07-27",
      generated_at: "2026-07-27T10:00:00+00:00",
      rows: [],
      totals: {
        team_members: 1,
        calls_made: -1,
        queries_handled: 0,
        mappings_completed: 0,
        tasks_completed: 0,
        total_completed_work: 0,
      },
    })).toThrow();
  });
});

describe("Team KPI error messaging", () => {
  it("identifies a missing RPC migration", () => {
    expect(getTeamKpiErrorMessage({ code: "PGRST202", message: "Function not found in schema cache" }))
      .toContain("unavailable");
  });

  it("identifies authorization failures", () => {
    expect(getTeamKpiErrorMessage({ code: "42501", message: "Administrator access required" }))
      .toContain("not authorized");
  });
});
