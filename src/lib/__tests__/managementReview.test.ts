/** @jest-environment node */
import { createClient } from "@supabase/supabase-js";
import { GET } from "@/app/api/team-kpi/review/route";
import { createServerServiceClient } from "@/lib/serverBackendEnvironment";
import { buildManagementReview, managementReviewSchema, reviewBucket, type ReviewTask, type ReviewTarget } from "@/lib/teamKpi/review";
jest.mock("@/lib/serverBackendEnvironment", () => ({ createServerServiceClient: jest.fn(), backendUnavailableResponse: () => Response.json({}, { status: 503 }) }));
const id = (n: number) => `10000000-0000-4000-a000-${String(n).padStart(12, "0")}`;
const members = [1, 2].map(n => ({ user_id: id(n), name: `Employee ${n}`, role: "Field" }));
const task = (n: number, patch: Partial<ReviewTask> = {}): ReviewTask => ({ task_id: id(n), assigned_to: id(1), assigned_by: id(2), title: `Task ${n}`, description: null,
  priority: "High", status: "Pending", source: "manual", template_id: null, related_lead_id: null, due_date: "2026-09-09", created_at: "2026-09-08T01:00:00Z", is_active: true, ...patch });
const target: ReviewTarget = { target_id: id(30), assigned_to_user_id: id(1), target_name: "Exact target", target_username: "target30", city: "Pune", is_completed: false, created_at: "2026-09-08T01:00:00Z" };
const build = (tasks: ReviewTask[], taskError: string | null = null, targetError: string | null = null, employee: string | null = null) => buildManagementReview({ members, tasks, targets: [target], today: "2026-09-09", generatedAt: "2026-09-09T01:00:00Z", employee, taskError, targetError });

it("keeps current assignee buckets, Missed and targets distinct; excludes inactive/generated/Completed records", () => {
  const rows = [task(10, { due_date: "2026-09-08" }), task(11), task(12, { due_date: "2026-09-10" }), task(13, { status: "Missed" }),
    task(14, { status: "Completed" }), task(15, { is_active: false }), task(16, { assigned_by: null, related_lead_id: id(40), title: "Follow up: Example (Contacted)", description: "Lead moved to Contacted. Follow up before it goes stale." }),
    task(17, { source: "template", title: "Follow-up template" }), task(18, { assigned_to: id(2) }), task(19, { assigned_to: id(99) })];
  const report = build(rows);
  expect(report.tasks.total).toBe(5); expect(report.targets.total).toBe(1);
  expect(report.employees[0]).toEqual({ user_id: id(1), tasks: { Overdue: 1, Today: 1, Later: 1, Missed: 1 }, targets: 1 });
  expect(report.employees[1].tasks?.Today).toBe(1);
  expect(reviewBucket(rows[3], "2026-09-09")).toBe("Missed");
  expect(report.targets.records[0]).not.toHaveProperty("due_date");
});

it("deduplicates genuine scheduled follow-ups per assignee, never across employees", () => {
  const description = `Scheduled follow-up for: Exact client\n[ZD_FOLLOWUP_SOURCE_CALL:${id(90)}]`;
  const report = build([task(10, { assigned_by: id(1), description }), task(11, { assigned_by: id(1), description }), task(12, { assigned_to: id(2), assigned_by: id(2), description })]);
  expect(report.tasks.total).toBe(2); expect(report.employees.map(row => row.tasks?.Today)).toEqual([1, 1]);
  expect(build([task(10, { assigned_by: id(1), description }), task(11, { assigned_by: id(1), description, status: "Completed" })]).tasks.total).toBe(0);
});

it("rejects contradictory totals, duplicate employees and complete-looking partial summaries", () => {
  const report = build([task(10)]);
  expect(managementReviewSchema.safeParse({ ...report, tasks: { ...report.tasks, total: 2 } }).success).toBe(false);
  expect(managementReviewSchema.safeParse({ ...report, employees: [report.employees[0], report.employees[0]] }).success).toBe(false);
  expect(managementReviewSchema.safeParse({ ...report, tasks: { ...report.tasks, complete: false, total: null } }).success).toBe(false);
});

it("preserves bounded partial records without presenting complete totals or blocking the other source", () => {
  const report = build(Array.from({ length: 60 }, (_, n) => task(n + 100)), "Source capped");
  expect(report.tasks.records).toHaveLength(50); expect(report.tasks.total).toBeNull(); expect(report.employees.every(row => row.tasks === null)).toBe(true);
  expect(report.targets.complete).toBe(true); expect(report.targets.total).toBe(1);
  expect(build([task(10)], null, "Targets unavailable").tasks.total).toBe(1);
});

it("narrowing preserves reference identities but shows only the selected current assignee", () => {
  const report = build([task(10), task(11, { assigned_to: id(2) })], null, null, id(2));
  expect(report.cohort).toEqual(members); expect(report.tasks.records.map(row => row.task_id)).toEqual([id(11)]); expect(report.targets.total).toBe(0);
});

describe("Admin Review route with installed SDK transport", () => {
  afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });
  const request = (query = "", signal?: AbortSignal) => new Request(`https://fixture.invalid/api/team-kpi/review${query}`, { headers: { Authorization: "Bearer synthetic" }, signal });
  function backend(options: { admin?: boolean; active?: boolean; taskRows?: ReviewTask[]; targetRows?: ReviewTarget[]; failTasks?: boolean; cap?: boolean } = {}) {
    const urls: URL[] = [];
    jest.spyOn(globalThis, "fetch").mockImplementation(async input => {
      const url = new URL(String(input)); urls.push(url);
      const params = url.searchParams, table = url.pathname.split("/").at(-1);
      if (table === "user") return Response.json({ id: id(1) });
      if (table === "users" && params.get("select") === "user_id,is_active") return Response.json([{ user_id: id(1), is_active: options.active ?? true }]);
      if (table === "user_capabilities" && params.has("capability_code")) return Response.json(options.admin === false ? [] : [{ capability_code: "admin" }]);
      if (table === "users") return Response.json(members.map(row => ({ ...row, is_active: true })), { headers: { "Content-Range": "0-1/2" } });
      if (table === "user_capabilities") return Response.json(members.map(row => ({ user_id: row.user_id, capability_code: "field_ret" })), { headers: { "Content-Range": "0-1/2" } });
      if (table === "capabilities") return Response.json([{ code: "field_ret", label: "Field" }], { headers: { "Content-Range": "0-0/1" } });
      if (table === "tasks" || table === "allocated_targets") {
        const tasks = table === "tasks", key = tasks ? "task_id" : "target_id";
        expect(params.get("limit")).toBe("500"); expect(params.get("order")).toBe(`${key}.asc`);
        if (tasks) { expect(params.get("is_active")).toBe("eq.true"); expect(params.has("status")).toBe(false); }
        else expect(params.get("is_completed")).toBe("eq.false");
        if (tasks && options.failTasks) return Response.json({ code: "fixture", message: "Unavailable" }, { status: 503 });
        const selected = params.get(tasks ? "assigned_to" : "assigned_to_user_id")!;
        expect(selected).toMatch(/^in\.\(/);
        const cursor = params.get(key)?.slice(3) ?? "";
        if (tasks && options.cap) {
          const start = cursor ? Number(cursor.slice(-12)) + 1 : 1000;
          return Response.json(Array.from({ length: 500 }, (_, n) => task(start + n, { title: "x", assigned_by: null })));
        }
        const rows = tasks ? options.taskRows ?? [task(10)] : options.targetRows ?? [target];
        return Response.json(rows.filter(row => selected.includes("assigned_to" in row ? row.assigned_to : row.assigned_to_user_id)).filter(row => ("task_id" in row ? row.task_id : row.target_id) > cursor));
      }
      throw new Error(`Unexpected Review request ${url.pathname}`);
    });
    jest.mocked(createServerServiceClient).mockImplementation(options => ({ ok: true, client: createClient("https://fixture.invalid", "synthetic", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: options!.fetch! } }) }));
    return urls;
  }
  it("requires an active live Admin; task assignment or a page path never grants access", async () => {
    for (const options of [{ active: false }, { admin: false }]) {
      const urls = backend(options); expect((await GET(request())).status).toBe(403);
      expect(urls.some(url => /tasks|allocated_targets|capabilities$/.test(url.pathname) && url.pathname.endsWith("/capabilities"))).toBe(false);
      expect(urls.some(url => url.pathname.endsWith("/tasks") || url.pathname.endsWith("/allocated_targets"))).toBe(false);
    }
  });
  it("validates employee selection before workload reads and preserves the stable reference cohort", async () => {
    for (const query of ["?employee=not-a-uuid", `?employee=${id(1)}&employee=${id(2)}`, "?user_id=override", `?employee=${id(99)}`]) {
      const urls = backend(); expect((await GET(request(query))).status).toBe(query.includes(id(99)) ? 404 : 400);
      expect(urls.some(url => url.pathname.endsWith("/tasks"))).toBe(false);
    }
    const urls = backend({ taskRows: [task(10), task(11, { assigned_to: id(2) })] });
    const response = await GET(request(`?employee=${id(2)}`)), body = await response.json();
    expect(response.status).toBe(200); expect(body.cohort).toHaveLength(2); expect(body.employees).toHaveLength(1);
    expect(body.tasks.records.map((row: ReviewTask) => row.task_id)).toEqual([id(11)]);
    for (const url of urls.filter(url => /\/(tasks|allocated_targets)$/.test(url.pathname))) expect(url.searchParams.get(url.pathname.endsWith("/tasks") ? "assigned_to" : "assigned_to_user_id")).toBe(`in.(${id(2)})`);
    expect(body.diagnostics).toMatchObject({ auth_http_requests: 1, authorization_db_http_requests: 2, reader_http_requests: 6 });
    expect(urls).toHaveLength(9);
  });
  it("caps physical source pages and returns null partial totals without hiding the other source", async () => {
    const urls = backend({ cap: true }); const response = await GET(request()), body = await response.json();
    expect(response.status).toBe(200); expect(body.tasks.complete).toBe(false); expect(body.tasks.total).toBeNull(); expect(body.tasks.records).toHaveLength(50);
    expect(body.targets.total).toBe(1); expect(urls.filter(url => url.pathname.endsWith("/tasks"))).toHaveLength(10);
    expect(body.diagnostics.reader_http_requests).toBe(15);
    const failed = backend({ failTasks: true }); const unavailable = await (await GET(request())).json();
    expect(unavailable.tasks.total).toBeNull(); expect(unavailable.targets.total).toBe(1);
    expect(failed.filter(url => url.pathname.endsWith("/tasks"))).toHaveLength(1);
  });
  it("cancels Auth at the shared deadline and issues no subsequent DB requests", async () => {
    jest.useFakeTimers(); backend();
    const transport = jest.mocked(globalThis.fetch).mockImplementation((_input, init) => new Promise((_resolve, reject) => init!.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })));
    const result = GET(request()); await jest.advanceTimersByTimeAsync(8001);
    expect((await result).status).toBe(503); expect(transport).toHaveBeenCalledTimes(1);
    const controller = new AbortController(); controller.abort();
    expect((await GET(request("", controller.signal))).status).toBe(503); expect(transport).toHaveBeenCalledTimes(1);
  });
});
