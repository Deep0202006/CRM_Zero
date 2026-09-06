import fs from "node:fs";
import path from "node:path";
import { loadCallHistoryWithOptionalMetrics, type CallHistoryDependencies } from "@/app/api/call-logs/history/service";
import { mergeConfirmedAndPendingCalls } from "../callLogs/repository";
import type { LocalCallLog } from "../db";

const source = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
const employeeId = "00000000-0000-4000-8000-000000000001";
const remoteId = "00000000-0000-4000-8000-000000000101";
const pendingId = "00000000-0000-4000-8000-000000000102";

function call(logId: string, timestamp: string, outcome = "Reached"): LocalCallLog {
  return { log_id: logId, user_id: employeeId, lead_id: null, client_name: "Sanitized fixture", client_username: null, timestamp, outcome, notes: null, next_followup_date: null };
}

function dependencies(overrides: Partial<CallHistoryDependencies> = {}): CallHistoryDependencies {
  return {
    history: async () => ({ data: [call(remoteId, "2026-08-10T06:00:00.000Z")], error: null, count: 1 }),
    todayCalls: async () => ({ data: [call(remoteId, "2026-08-10T06:00:00.000Z")], error: null }),
    tasks: async () => ({ data: [], error: null }),
    taskHistory: async () => ({ data: [], error: null }),
    ...overrides,
  };
}

describe("call-history authority incident", () => {
  it("returns authoritative history when optional task metrics fail", async () => {
    const response = await loadCallHistoryWithOptionalMetrics(dependencies({ tasks: async () => ({ data: null, error: { code: "OPTIONAL_SOURCE_UNAVAILABLE" } }) }), employeeId, 1);
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.calls.map((item: LocalCallLog) => item.log_id)).toEqual([remoteId]);
    expect(body.metrics_authoritative).toBe(false);
    expect(body.metric_warning).toBe("CALL_METRICS_DEGRADED");
    expect(body.confirmed_genuine_call_ids).toEqual([remoteId]);
  });

  it("fails only when the authoritative call-history query fails", async () => {
    const response = await loadCallHistoryWithOptionalMetrics(dependencies({ history: async () => ({ data: null, error: { code: "HISTORY_UNAVAILABLE" }, count: null }) }), employeeId, 1);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ code: "CALL_HISTORY_FAILED" });
  });

  it("reports a rejected authoritative query explicitly", async () => {
    const response = await loadCallHistoryWithOptionalMetrics(dependencies({ history: async () => { throw new Error("network"); } }), employeeId, 1);
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ code: "CALL_HISTORY_FAILED" });
  });

  it("shows a server-only confirmed call even after its outbox entry is gone", () => {
    expect(mergeConfirmedAndPendingCalls([call(remoteId, "2026-08-10T06:00:00.000Z")], []).map((item) => item.log_id)).toEqual([remoteId]);
  });

  it("unions confirmed and pending calls exactly once with pending-edit precedence", () => {
    const staleLocal = call(remoteId, "2026-08-10T05:59:00.000Z", "Stale local outcome");
    const authoritative = call(remoteId, "2026-08-10T06:00:00.000Z", "Authoritative outcome");
    const pending = call(pendingId, "2026-08-10T06:01:00.000Z");
    const merged = mergeConfirmedAndPendingCalls([authoritative], [staleLocal, pending]);
    expect(merged.map((item) => item.log_id)).toEqual([pendingId, remoteId]);
    expect(merged.find((item) => item.log_id === remoteId)?.outcome).toBe("Stale local outcome");
  });

  it("keeps ownership server-derived and admin scope capability-controlled", () => {
    const route = source("src/app/api/call-logs/history/route.ts");
    expect(route).toContain('authClient.auth.getUser(token)');
    expect(route).toContain('.eq("user_id", auth.user.id)');
    expect(route).toContain('capability_code === "admin"');
    expect(route).not.toContain('searchParams.get("user_id")');
  });

  it("retains IST daily bounds, deterministic history ordering, and visible degraded states", () => {
    const route = source("src/app/api/call-logs/history/route.ts");
    const repository = source("src/lib/callLogs/repository.ts");
    const page = source("src/app/call-logs/page.tsx");
    expect(route).toContain("getIstDayBounds(today)");
    expect(route).toContain('.order("timestamp", { ascending: false })');
    expect(route).toContain('.order("log_id", { ascending: false })');
    expect(repository).toContain("Offline: showing durable calls saved on this device");
    expect(repository).toContain("Confirmed call history could not be refreshed");
    expect(page).toContain("historyNotice");
    expect(page.indexOf("setLogs(fetchedLogs)")).toBeLessThan(page.indexOf('await db.tasks.where("assigned_to")'));
    expect(page).toContain("optional local display enrichment is unavailable");
    expect(page).toContain("void processSyncQueue().catch");
    expect(page).toContain('window.addEventListener(CALL_LOGS_CHANGED_EVENT, refreshAuthority)');
    expect(page).toContain('window.addEventListener("focus", refreshOnFocus)');
  });

  it("contains the existing exact-confirmation and reconnect recovery hooks", () => {
    const database = source("src/lib/db.ts");
    expect(database).toContain("result.log_id !== payload.log_id");
    expect(database).toContain("current?.idempotency_key === idempotencyKey");
    expect(database).toContain("await db.sync_queue.delete(item.id)");
    expect(database).toContain('window.dispatchEvent(new CustomEvent("zerodata:call-logs-changed"))');
  });

  it("contains the existing exact-confirmation and reconnect recovery hooks", () => {
    const database = source("src/lib/db.ts");
    expect(database).toContain("result.log_id !== payload.log_id");
    expect(database).toContain("current?.idempotency_key === idempotencyKey");
    expect(database).toContain("await db.sync_queue.delete(item.id)");
    expect(database).toContain('window.dispatchEvent(new CustomEvent("zerodata:call-logs-changed"))');
  });

  it("contains no new destructive call or browser recovery path", () => {
    const changed = [source("src/app/api/call-logs/history/route.ts"), source("src/lib/callLogs/repository.ts"), source("src/app/call-logs/page.tsx")].join("\n");
    expect(changed).not.toMatch(/call_logs\.clear\s*\(|call_logs\.bulkDelete\s*\(|localStorage\.clear\s*\(|deleteDatabase\s*\(/);
    expect(changed).not.toMatch(/from\(["']call_logs["']\)[\s\S]{0,120}\.delete\s*\(/);
  });
});
