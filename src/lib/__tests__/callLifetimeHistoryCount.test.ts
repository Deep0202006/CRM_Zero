import fs from "node:fs";
import path from "node:path";
import { historyBody, loadCallHistoryWithOptionalMetrics, type CallHistoryDependencies } from "@/app/api/call-logs/history/service";
import { formatCallHistoryCount } from "../callLogs/repository";
import type { LocalCallLog } from "../db";

const employeeId = "00000000-0000-4000-8000-000000000001";
const source = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
const call = (logId: string, timestamp: string): LocalCallLog => ({
  log_id: logId, user_id: employeeId, lead_id: null, client_name: "Fixture", client_username: null,
  timestamp, outcome: "Reached", notes: null, next_followup_date: null,
});

function dependencies(rows: LocalCallLog[], total: number): CallHistoryDependencies {
  return {
    history: async () => ({ data: rows, error: null, count: total }),
    todayCalls: async () => ({ data: [], error: null }),
    tasks: async () => ({ data: [], error: null }),
    taskHistory: async () => ({ data: [], error: null }),
  };
}

describe("lifetime call-history count", () => {
  it.each([1, 2])("keeps total 347 independent from the 100-row page (page %i)", async (page) => {
    const rows = Array.from({ length: 100 }, (_, index) => call(`00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, "2026-08-10T06:00:00.000Z"));
    const response = await loadCallHistoryWithOptionalMetrics(dependencies(rows, 347), employeeId, page);
    const body = await response.json();
    expect(body.calls).toHaveLength(100);
    expect(body.total).toBe(347);
    expect(body.has_more).toBe(page < 4);
  });

  it("counts June, July, and August rows without today's metric bounds changing lifetime total", () => {
    const rows = [call("a", "2026-06-01T00:00:00.000Z"), call("b", "2026-07-01T00:00:00.000Z"), call("c", "2026-08-10T00:00:00.000Z")];
    expect(historyBody({ data: rows, error: null, count: 3 }, 1).total).toBe(3);
    const route = source("src/app/api/call-logs/history/route.ts");
    expect(route.indexOf('.select("log_id,user_id,lead_id')).toBeLessThan(route.indexOf("const today = getCurrentISTDate()"));
    expect(route).not.toContain("2026-08-01");
  });

  it("presents authoritative, pending, and loaded counts as separate contracts", () => {
    expect(formatCallHistoryCount({ authoritative: true, lifetimeConfirmedTotal: 347, pendingCount: 2, loadedCount: 102 }))
      .toBe("347 lifetime confirmed records · 2 pending sync · showing latest 102");
    expect(formatCallHistoryCount({ authoritative: true, lifetimeConfirmedTotal: 348, pendingCount: 0, loadedCount: 100 }))
      .toBe("348 lifetime confirmed records · showing latest 100");
  });

  it("labels an offline fallback as device-local rather than lifetime authority", () => {
    expect(formatCallHistoryCount({ authoritative: false, lifetimeConfirmedTotal: null, pendingCount: 2, loadedCount: 82 }))
      .toBe("82 records available on this device · 2 pending sync");
  });

  it("keeps QueueList backward compatible unless a count description is supplied", () => {
    const queue = source("src/components/QueueList.tsx");
    expect(queue).toContain("countDescription?: React.ReactNode");
    expect(queue).toContain("countDescription ??");
    expect(queue).toContain('items.length === 1 ? "record" : "records"');
    expect(source("src/app/call-logs/page.tsx")).toContain("countDescription={historyCountDescription}");
  });

  it("retains authenticated owner scoping, admin capability checks, exact count, and bounded loading", () => {
    const route = source("src/app/api/call-logs/history/route.ts");
    expect(route).toContain('const PAGE_SIZE = 100');
    expect(route).toContain('{ count: "exact" }');
    expect(route).toContain('.eq("user_id", auth.user.id)');
    expect(route).toContain('capability_code === "admin"');
    expect(route).toContain('.range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)');
    expect(route).not.toContain('searchParams.get("user_id")');
  });

  it("preserves today's canonical metric and non-destructive call contracts", () => {
    const page = source("src/app/call-logs/page.tsx");
    const route = source("src/app/api/call-logs/history/route.ts");
    const service = source("src/app/api/call-logs/history/service.ts");
    const changed = [page, route, service, source("src/lib/callLogs/repository.ts")].join("\n");
    expect(page).toContain("snapshot.confirmedGenuineCallIds");
    expect(page).toContain("snapshot.confirmedFollowupCallIds");
    expect(page).toContain("snapshot.confirmedReachedCallIds");
    expect(service).toContain("getCanonicalDailyUserMetrics");
    expect(changed).not.toMatch(/call_logs\.clear\s*\(|call_logs\.bulkDelete\s*\(|localStorage\.clear\s*\(|deleteDatabase\s*\(/);
    expect(changed).not.toMatch(/from\(["']call_logs["']\)[\s\S]{0,120}\.delete\s*\(/);
  });
});
