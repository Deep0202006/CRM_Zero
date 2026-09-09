/** @jest-environment node */
import fs from "node:fs";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/my-day/daily-summary/route";
import { createServerAnonClient, createServerServiceClient } from "@/lib/serverBackendEnvironment";
import { loadTeamKpiServerReport } from "@/lib/teamKpi/serverReport";

jest.mock("@/lib/serverBackendEnvironment", () => ({ createServerAnonClient: jest.fn(), createServerServiceClient: jest.fn(), backendUnavailableResponse: () => Response.json({}, { status: 503 }) }));
jest.mock("@/lib/teamKpi/serverReport", () => ({ loadTeamKpiServerReport: jest.fn(), getIstDayBounds: () => ({ startsAt: "2026-09-08T18:30:00Z", endsAt: "2026-09-09T18:30:00Z" }) }));
jest.mock("@/lib/dateTime", () => ({ getCurrentISTDate: () => "2026-09-09" }));
const actor = "91000000-0000-4000-a000-000000000001";
function setup(active = true) {
  jest.mocked(createServerAnonClient).mockReturnValue({ ok: true, client: { auth: { getUser: async () => ({ data: { user: { id: actor } }, error: null }) } } } as unknown as ReturnType<typeof createServerAnonClient>);
  const queries: Array<{ table: string; filters: unknown[][] }> = [];
  const from = jest.fn((table: string) => {
    if (table === "leads" || table === "pipeline_transition_operations") throw new Error("Pipeline consumption is forbidden in My Day");
    const query = { table, filters: [] as unknown[][] }; queries.push(query);
    const result = () => ({ error: null, data: table === "users" ? { user_id: actor, is_active: active } : table === "tasks" && !query.filters.some(args => args[0] === "eq" && args[1] === "status") ? [{ task_id: "assigned-task", assigned_to: actor, assigned_by: "manager", title: "Genuine linked work", priority: "High", due_date: "2026-09-08", related_lead_id: "exact-lead", source: "manual", status: "Pending", description: "Assigned work" }] : [] });
    const chain = {
      select: () => chain, eq: (...args: unknown[]) => { query.filters.push(["eq", ...args]); return chain; },
      neq: (...args: unknown[]) => { query.filters.push(["neq", ...args]); return chain; },
      gte: (...args: unknown[]) => { query.filters.push(["gte", ...args]); return chain; },
      lt: (...args: unknown[]) => { query.filters.push(["lt", ...args]); return chain; },
      order: () => chain, limit: () => chain, in: () => chain,
      maybeSingle: async () => result(), then: (resolve: (value: unknown) => unknown) => Promise.resolve(resolve(result())),
    }; return chain;
  });
  jest.mocked(createServerServiceClient).mockReturnValue({ ok: true, client: { from } } as unknown as ReturnType<typeof createServerServiceClient>);
  jest.mocked(loadTeamKpiServerReport).mockResolvedValue({ rows: [], generated_at: "2026-09-09T04:00:00Z" } as unknown as Awaited<ReturnType<typeof loadTeamKpiServerReport>>);
  return { from, queries };
}
beforeEach(() => jest.clearAllMocks());
it("keeps authentication and active-user authorization ahead of report reads", async () => {
  const { from } = setup();
  expect((await GET(new NextRequest("http://localhost/api/my-day/daily-summary"))).status).toBe(401);
  expect(from).not.toHaveBeenCalled();
  setup(false);
  expect((await GET(new NextRequest("http://localhost/api/my-day/daily-summary", { headers: { authorization: "Bearer fixture" } }))).status).toBe(403);
  expect(loadTeamKpiServerReport).not.toHaveBeenCalled();
});
it("returns genuine task-only focus without Pipeline readers and retains canonical IST-scoped work", async () => {
  const { from, queries } = setup();
  const response = await GET(new NextRequest("http://localhost/api/my-day/daily-summary", { headers: { authorization: "Bearer fixture" } }));
  expect(response.status).toBe(200);
  expect((await response.json()).focus_signals).toEqual([expect.objectContaining({ kind: "task", title: "Genuine linked work", related_lead_id: "exact-lead" })]);
  expect(from).not.toHaveBeenCalledWith("leads");
  expect(from).not.toHaveBeenCalledWith("pipeline_transition_operations");
  expect(queries.find(query => query.table === "call_logs")?.filters).toEqual(expect.arrayContaining([["eq", "user_id", actor], ["gte", "timestamp", "2026-09-08T18:30:00Z"], ["lt", "timestamp", "2026-09-09T18:30:00Z"]]));
  const page = fs.readFileSync("src/app/my-day/page.tsx", "utf8");
  expect(page).not.toMatch(/weekly_digest_log|exportPipelineToExcel|setLeadsConverted/);
  expect(page).toContain("db.leads.bulkGet");
  expect(page).toContain('const logId = task.task_id');
});
