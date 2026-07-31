import fs from "fs";
import path from "path";

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

describe("production consistency guards", () => {
  it("never clears IndexedDB during logout and retains an unconfirmed outbox", () => {
    const auth = source("src/context/AuthContext.tsx");
    expect(auth).not.toContain("db.tables.map(table => table.clear())");
    expect(auth).toContain("const pendingOperations = await db.sync_queue.count()");
    expect(auth).toContain('anyOf(["pending_sync", "sync_failed"])');
    expect(auth).toContain("await Promise.all([processSyncQueue(), syncFieldVisits()])");
    expect(auth).toContain("if (pendingOperations > 0 || pendingVisits > 0)");
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
    expect(callLogs).toContain('db.call_logs.where("user_id").equals(currentUser.user_id)');
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
    expect(database).toContain("call.user_id === authenticatedUserId");
    expect(database).toContain("task.assigned_to === authenticatedUserId");
    expect(database).toContain("if (pendingMutation) return");
    expect(database).not.toMatch(/^[ \t]*await table\.bulkDelete\(safeIdsToDelete\)/m);
  });

  it("keeps KPI today-only with unavailable values instead of fake zeros", () => {
    const route = source("src/app/api/team-kpi/route.ts");
    const page = source("src/app/manager/kpi/page.tsx");
    expect(route).toContain("const targetDate = getCurrentISTDate()");
    expect(route).not.toContain('searchParams.get("date")');
    expect(page).not.toMatch(/type=["']date["']/);
    expect(page).toContain('value={report ? totals.calls_made : "—"}');
    expect(page).toContain("The last confirmed report remains visible below.");
  });

  it("does not restore dummy companies or automatic follow-up templates", () => {
    const myDay = source("src/app/my-day/page.tsx");
    const taskEngine = source("src/lib/taskEngine.ts");
    expect(myDay).not.toContain("Acme Corp");
    expect(myDay).not.toContain("Global Tech");
    expect(taskEngine).toContain("!isFollowUpLikeTemplate(tpl)");
  });
});
