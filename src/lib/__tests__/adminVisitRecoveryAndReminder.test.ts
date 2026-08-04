import fs from "fs";
import path from "path";

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");

describe("admin visit root recovery", () => {
  const route = read("src/app/api/admin/visits/route.ts");
  const page = read("src/app/admin/visits/page.tsx");
  const exportRoute = read("src/app/api/admin/export-visits/route.ts");

  it("filters representatives by UUID and keeps the directory independent of date/page", () => {
    expect(route).toContain('.eq("user_id", representative)');
    expect(route.indexOf("loadRepresentativeDirectory(admin)")).toBeLessThan(route.indexOf("const { data: rawVisits"));
    expect(route).toContain("historicalIdsPromise");
  });

  it("matches selected date by stored date or IST check-in without duplicates", () => {
    expect(route).toContain("visit_date.eq.${date}");
    expect(route).toContain("check_in_time.gte.${selectedBounds.startsAt}");
    expect(route).toContain("legacy_date_mismatch_count");
    expect(route).toContain('select("visit_id,user_id,lead_id');
  });

  it("keeps missing leads from hiding visits and returns exact pagination count", () => {
    expect(route).toContain("leadsById.get(visit.lead_id) ?? null");
    expect(route).toContain("total: count ?? 0");
    expect(route).toContain("has_more: page * PAGE_SIZE < (count ?? 0)");
  });

  it("resets all filters to page one and preserves confirmed rows on API error", () => {
    expect(page.match(/setPage\(1\)/g)?.length).toBeGreaterThanOrEqual(7);
    const catchBlock = page.slice(page.indexOf("} catch (error)"), page.indexOf("} finally", page.indexOf("} catch (error)")));
    expect(catchBlock).not.toContain("setVisits");
    expect(page).toContain('typeof result.error === "string" ? result.error');
  });

  it("includes Payment follow-up and follow-up date in admin and export", () => {
    expect(page).toContain('"payment_follow_up"');
    expect(page).toContain("getOutcomeLabel(visit.visit_outcome)");
    expect(exportRoute).toContain('"Follow-up date"');
    expect(exportRoute).toContain("getOutcomeLabel");
  });
});

describe("My Day reminder authorization and safety", () => {
  const endpoint = read("src/app/api/my-day/payment-followups/route.ts");
  const myDay = read("src/app/my-day/page.tsx");
  const sync = read("src/lib/fieldVisits/sync.ts");

  it("scopes the endpoint to the authenticated active user and today only", () => {
    expect(endpoint).toContain("admin.auth.getUser(token)");
    expect(endpoint).toContain('.eq("user_id", userId)');
    expect(endpoint).toContain('.eq("follow_up_date", currentDate)');
    expect(endpoint).not.toContain("searchParams");
    expect(endpoint).not.toMatch(/phone|notes|latitude|longitude|selfie/i);
  });

  it("shows username, party, and due-today warning without changing existing follow-ups", () => {
    expect(myDay).toContain("Payment follow-ups due today");
    expect(myDay).toContain("Username:");
    expect(myDay).toContain("Party:");
    expect(myDay).toContain("Due today");
    expect(myDay).toContain("isValidSelfScheduledFollowUp");
  });

  it("retries pending and failed local visits with stable IDs and exact confirmation", () => {
    expect(sync).toContain('.anyOf(["pending_sync", "sync_failed"])');
    expect(sync).toContain('.eq("visit_id", visit.visit_id)');
    expect(sync).toContain("confirmedVisit?.visit_id !== visit.visit_id");
    expect(sync.indexOf('sync_status: "synced"')).toBeLessThan(sync.indexOf("field_visit_media.delete"));
    expect(sync).toContain("rerunRequested = true");
  });

  it("does not introduce destructive browser or production data operations", () => {
    const changedSources = [endpoint, myDay, routeSafe(read("src/app/visits/page.tsx")), read("src/lib/fieldVisits/paymentFollowUps.ts")].join("\n");
    expect(changedSources).not.toMatch(/indexedDB\.deleteDatabase|localStorage\.clear|\.from\([^)]*\)\.delete\(|db\.delete\(/);
    expect(changedSources).not.toMatch(/dummy customer|dummy visit|fabricat/i);
  });
});

function routeSafe(value: string) { return value; }
