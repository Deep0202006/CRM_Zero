import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CompositionStrip, compositionReconciles } from "@/components/analytics/CompositionStrip";
import { WorkAgenda, taskAgendaView } from "@/components/workspace/WorkAgenda";
import { getOrGenerateTodayTasks, sortTasks, type LocalTask } from "@/lib/taskEngine";

const mockTasks: LocalTask[] = [];
jest.mock("@/lib/dateTime", () => ({ getCurrentISTDate: () => "2026-09-09" }));
jest.mock("@/lib/supabaseClient", () => ({ isSupabaseConfigured: false }));
jest.mock("@/lib/db", () => ({
  db: {
    tasks: { where: (key: string) => {
      let rows = [...mockTasks];
      const chain = {
        equals: (value: unknown) => { rows = rows.filter(task => key === "[assigned_to+due_date]" ? JSON.stringify([task.assigned_to, task.due_date]) === JSON.stringify(value) : task[key as keyof LocalTask] === value); return chain; },
        filter: (predicate: (task: LocalTask) => boolean) => { rows = rows.filter(predicate); return chain; },
        and: (predicate: (task: LocalTask) => boolean) => { rows = rows.filter(predicate); return chain; },
        toArray: async () => rows,
      }; return chain;
    } },
    task_templates: { toArray: async () => [] },
  },
}));
const task = (id: string, due: string, status: LocalTask["status"] = "Pending"): LocalTask => ({
  task_id: id, assigned_to: "actor", assigned_by: "manager", title: id, description: "Assigned work",
  source: "manual", related_lead_id: "exact-lead", due_date: due, status, priority: "Medium",
  template_id: null, started_at: null, completed_at: null, proof_note: null, proof_photo_url: null,
  created_at: "2026-09-08T02:00:00Z",
});

it("loads real Later records only for the opted-in My Day consumer, preserving scope and genuine linked tasks", async () => {
  mockTasks.splice(0, mockTasks.length, task("overdue", "2026-09-08"), task("today", "2026-09-09"), task("later", "2026-09-10"), task("done", "2026-09-09", "Completed"), { ...task("other", "2026-09-09"), assigned_to: "other" }, { ...task("inactive", "2026-09-09"), is_active: false });
  expect((await getOrGenerateTodayTasks("actor", [])).map(row => row.task_id).sort()).toEqual(["done", "overdue", "today"]);
  const agenda = await getOrGenerateTodayTasks("actor", [], { includeLater: true });
  expect(agenda.map(row => taskAgendaView(row, "2026-09-09")).sort()).toEqual(["Done", "Later", "Overdue", "Today"]);
  expect(agenda.every(row => row.related_lead_id === "exact-lead")).toBe(true);
  expect(sortTasks([task("b", "2026-09-09"), task("a", "2026-09-09")]).map(row => row.task_id)).toEqual(["a", "b"]);
});

it("keeps Missed records read-only and exposes only existing eligible actions", () => {
  const html = renderToStaticMarkup(createElement(WorkAgenda, { tasks: [task("missed-record", "2026-09-08", "Missed")], today: "2026-09-09", view: "Overdue", onView: jest.fn(), selectedId: null, onSelect: jest.fn(), onComplete: jest.fn(), onDelete: jest.fn(), canDelete: () => true, markingId: null }));
  expect(html).toContain("missed-record");
  expect(html).not.toContain("Delete missed-record");
  expect(html).not.toContain("Done ✓");
});

it("only draws an exact nonnegative integer partition, retaining historical categories and honest emptiness", () => {
  const items = [{ key: "follow_up", label: "Follow-up", value: 2, color: "var(--viz-warning)" }, { key: "unknown", label: "Other / historical", value: 1, color: "var(--viz-muted)" }];
  expect(compositionReconciles(items, 3)).toBe(true);
  for (const value of [-1, NaN, 0.5, Infinity]) expect(compositionReconciles([{ ...items[0], value }], value)).toBe(false);
  expect(compositionReconciles(items, 4)).toBe(false);
  const html = renderToStaticMarkup(createElement(CompositionStrip, { items, total: 3, scope: "Loaded page 2", onSelect: jest.fn() }));
  expect(html).toContain("Other / historical");
  expect(html).not.toContain("Filter outcome: Other");
  expect(html).toContain("Loaded page 2");
  expect(renderToStaticMarkup(createElement(CompositionStrip, { items: [], total: 0, scope: "Empty page" }))).toContain("No loaded visits");
});
