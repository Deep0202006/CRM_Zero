import fs from "fs";
import path from "path";

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");

describe("core reliability release contracts", () => {
  it("mounts one shared Enter navigator and preserves textarea/native controls", () => {
    const helper = read("src/lib/formNavigation.ts");
    const navigator = read("src/components/FormEnterNavigator.tsx");
    const layout = read("src/components/DashboardLayout.tsx");
    expect(layout).toContain("<FormEnterNavigator />");
    expect(navigator).toContain('document.addEventListener("keydown", handleFormNavigationKeyDown, true)');
    expect(helper).toContain("event.isComposing");
    expect(helper).toContain("target instanceof HTMLTextAreaElement");
    expect(helper).toContain('event.dataset.enterNavigation === "native"'.replace("event", "element"));
    expect(helper).toContain('hasNext ? "next" : "done"');
    expect(helper).toContain("event.preventDefault()");
    expect(helper).toContain("focusNextEligibleControl(target)");
    expect(navigator).toContain("MutationObserver");
  });

  it("lets SearchableSelect commit once before advancing", () => {
    const select = read("src/components/SearchableSelect.tsx");
    expect(select).toContain('data-enter-navigation={isOpen ? "native" : undefined}');
    expect(select).toContain("event.stopPropagation()");
    expect(select).toContain("if (option) selectOption(option, true)");
    expect(select).toContain("focusNextEligibleControl");
    expect(select).toContain('event.key === "Enter" && isOpen');
  });

  it("preflights visit IDs without a user filter and makes attendance/lead gaps warnings", () => {
    const route = read("src/app/api/field-visits/confirm/route.ts");
    expect(route).toContain('.select(select).eq("visit_id", visit.visit_id).maybeSingle()');
    expect(route).toContain("VISIT_ID_OWNERSHIP_COLLISION");
    expect(route).toContain("ATTENDANCE_LINK_PENDING");
    expect(route).toContain("BUSINESS_REFERENCE_WARNING");
    expect(route).not.toContain('if (!isAdmin && !resolvedAttendanceId)');
    expect(route.indexOf("const preflight")).toBeLessThan(route.indexOf('.from("field_visits").insert'));
  });

  it("drains call synchronization again and retries durable business items beyond five attempts", () => {
    const database = read("src/lib/db.ts");
    expect(database).toContain("let syncQueueRerunRequested = false");
    expect(database).toContain("syncQueueRerunRequested = true");
    expect(database).toContain("while (syncQueueRerunRequested)");
    expect(database).toContain("isEventuallyRetryableBusinessItem");
    expect(database).toContain('item.table_name === "call_logs" && item.action === "INSERT"');
    expect(database).toContain('remoteTableName === "call_logs" && authenticatedUserId');
    expect(read("src/app/call-logs/page.tsx")).toContain('idempotency_key: `call-log:${logId}`');
  });

  it("introduces no deletion or browser reset path for calls and visits", () => {
    const releaseSources = [
      "src/lib/db.ts", "src/lib/fieldVisits/sync.ts", "src/app/api/field-visits/confirm/route.ts",
      "src/app/call-logs/page.tsx", "src/app/my-day/page.tsx",
      "src/app/visits/new/retailer/page.tsx", "src/app/visits/new/distributor/page.tsx",
    ].map(read).join("\n");
    expect(releaseSources).not.toMatch(/from\(["']call_logs["']\)\.delete|from\(["']field_visits["']\)\.delete/);
    expect(releaseSources).not.toMatch(/call_logs\.clear\(|field_visits\.clear\(|(?:call_logs|field_visits)\.bulkDelete\(/);
    expect(releaseSources).not.toMatch(/indexedDB\.deleteDatabase|localStorage\.clear\(/);
    expect(read("src/lib/fieldVisits/sync.ts")).not.toContain("field_visit_media.delete");
  });

  it("uses the same simple Calls today wording and ID unions", () => {
    const myDay = read("src/app/my-day/page.tsx");
    const calls = read("src/app/call-logs/page.tsx");
    const kpi = read("src/app/manager/kpi/page.tsx");
    const summary = read("src/app/api/my-day/daily-summary/route.ts");
    expect(myDay).toContain('label="Calls today"');
    expect(calls).toContain('label="Calls today"');
    expect(kpi).toContain("Calls today");
    expect(summary).toContain("confirmed_genuine_call_ids");
    expect(myDay).toContain("new Set([...(summary.confirmed_genuine_call_ids ?? []), ...localIds]).size");
    expect(myDay).toContain("dailySummary?.genuine_calls_today ?? localCallsToday");
  });
});
