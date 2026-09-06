import fs from "fs";
import path from "path";

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("production consistency guards", () => {
  it("never clears IndexedDB during logout and retains an unconfirmed outbox", () => {
    const auth = source("src/context/AuthContext.tsx");
    expect(auth).not.toContain("db.tables.map(table => table.clear())");
    expect(auth).toContain("const queuedOperations = await db.sync_queue.toArray()");
    expect(auth).toContain("item.owner_user_id === currentUser.user_id");
    expect(auth).toContain('anyOf(["pending_sync", "sync_failed"])');
    expect(auth).toContain("await Promise.allSettled([processSyncQueue(), syncFieldVisits()])");
    expect(auth).toContain("if (pendingRetained)");
    expect(auth).toContain('localStorage.setItem("zerodata_outbox_owner_id", currentUser.user_id)');
    expect(auth).toContain('if (!pendingRetained) localStorage.removeItem("zerodata_outbox_owner_id")');
    expect(auth).toContain("(!storedOwner && hasUnownedItems)");
  });

  it("scopes personal cached call views to the authenticated user", () => {
    const dashboard = source("src/app/page.tsx");
    const onboarding = source("src/app/onboarding/page.tsx");
    const callLogs = source("src/app/call-logs/page.tsx");
    expect(dashboard).toContain('db.call_logs.where("user_id").equals(currentUser.user_id)');
    expect(dashboard).toContain('db.leads.where("assigned_to").equals(currentUser.user_id)');
    expect(dashboard).toContain('db.users.where("user_id").equals(currentUser.user_id)');
    expect(onboarding).toContain("isAdmin || log.user_id === currentUser?.user_id");
    expect(callLogs).toContain("fetchCallLogSnapshot(currentUser.user_id, isAdmin)");
  });

  it("unions confirmed and local call IDs while preserving server confirmation", () => {
    const repository = source("src/lib/callLogs/repository.ts");
    const callLogs = source("src/app/call-logs/page.tsx");
    const database = source("src/lib/db.ts");

    expect(repository).toContain('/api/call-logs/history?page=${page}');
    expect(repository).not.toContain('.from("call_logs")');
    expect(repository).toContain('lifetimeConfirmedTotal: typeof result.total === "number" ? result.total : null');
    expect(repository).toContain("confirmedLogs: sortNewestFirst(confirmedLogs)");
    expect(repository).toContain("pendingCount: unsyncedLogs.length");
    expect(callLogs).toContain("void processSyncQueue().catch");
    expect(callLogs).toContain("fetchCallLogSnapshot(currentUser.user_id, isAdmin)");
    expect(callLogs).toContain('label="Calls today"');
    expect(callLogs).toContain('label="Follow-up calls today"');
    expect(callLogs).toContain("const todayLogs = [...new Map(logs.filter");
    expect(callLogs).not.toContain('label="Waiting to sync"');
    expect(callLogs).not.toContain('label="Total records" value={logs.length}');
    expect(database.match(/zerodata:call-logs-changed/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps remote confirmation ahead of queue removal and preserves empty pulls", () => {
    const database = source("src/lib/db.ts");
    const verification = database.indexOf("verifyRemoteRowExists");
    const removal = database.indexOf("await db.sync_queue.delete(item.id)");
    expect(verification).toBeGreaterThan(-1);
    expect(removal).toBeGreaterThan(verification);
    expect(database).toContain("local data was preserved without recovery writes");
    expect(database).toContain("!pendingInsertIds.has(d[pk])");
    expect(database).toContain(".order(pk, { ascending: true })");
    expect(database).toContain("item.owner_user_id ?? legacyOwnerId");
    expect(database).toContain("itemOwnerId !== authenticatedUserId");
    expect(database).not.toContain("ensureLegacyKpiSourceRepairsQueued");
    expect(database).not.toContain("legacy-repair:call_logs");
    expect(database).toContain("if (pendingMutation) return");
    expect(database).not.toMatch(/^[ \t]*await table\.bulkDelete\(safeIdsToDelete\)/m);
  });

  it("keeps KPI today-only with unavailable values instead of fake zeros", () => {
    const route = source("src/app/api/team-kpi/route.ts");
    const page = source("src/app/manager/kpi/page.tsx");
    expect(route).toContain("const targetDate = getCurrentISTDate()");
    expect(route).not.toContain('searchParams.get("date")');
    expect(page).not.toMatch(/type=["']date["']/);
    expect(page).toContain('value={report ? <NumberTicker value={totals.calls_made} /> : "—"}');
    expect(page).toContain("The last confirmed report remains visible below.");
  });

  it("does not restore dummy companies or automatic follow-up templates", () => {
    const myDay = source("src/app/my-day/page.tsx");
    const taskEngine = source("src/lib/taskEngine.ts");
    expect(myDay).not.toContain("Acme Corp");
    expect(myDay).not.toContain("Global Tech");
    expect(taskEngine).toContain("!isFollowUpLikeTemplate(tpl)");
  });

  it("removes only the employee My Day waiting-to-sync presentation", () => {
    const myDay = source("src/app/my-day/page.tsx");
    const database = source("src/lib/db.ts");
    const auth = source("src/context/AuthContext.tsx");

    expect(myDay).not.toContain("Waiting to sync");
    expect(myDay).not.toContain("waitingToSync");
    expect(myDay).not.toContain("setWaitingToSync");
    expect(myDay).toContain("processSyncQueue");
    expect(myDay).toContain("claimSyncQueueOwnership");
    expect(myDay).toContain('/api/my-day/daily-summary');
    for (const label of ["Calls today", "Tasks done", "Unique completed work"]) {
      expect(myDay).toContain(label);
    }
    expect(auth).toContain("pendingRetained");
    expect(database).not.toContain("deleteDatabase(");
    expect(auth).not.toContain("db.tables.map(table => table.clear())");
  });
});
