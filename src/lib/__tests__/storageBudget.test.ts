import fs from "fs";
import path from "path";
import { isSafelyPrunable } from "../storageCleanup";
import { operationalCutoff, STORAGE_BUDGET, storageStatus } from "../storageBudget";

const old = "2025-01-01T00:00:00.000Z";
const confirmedCall = {
  log_id: "call-1",
  user_id: "user-1",
  timestamp: old,
  cache_confirmed_at: "2026-01-01T00:00:00.000Z",
};

describe("lightweight local storage safety", () => {
  it("prunes only old server-confirmed cache rows", () => {
    expect(isSafelyPrunable("call_logs", confirmedCall, "user-1", new Set(), "2026-01-01T00:00:00.000Z")).toBe(true);
    expect(isSafelyPrunable("call_logs", { ...confirmedCall, cache_confirmed_at: undefined }, "user-1", new Set(), "2026-01-01T00:00:00.000Z")).toBe(false);
  });

  it.each(["pending", "retry_wait", "permanent_failure"])("never prunes an outbox-referenced %s row", () => {
    expect(isSafelyPrunable("call_logs", confirmedCall, "user-1", new Set(["call-1"]), "2026-01-01T00:00:00.000Z")).toBe(false);
  });

  it("is user scoped and preserves unresolved local state", () => {
    expect(isSafelyPrunable("call_logs", confirmedCall, "user-2", new Set(), "2026-01-01T00:00:00.000Z")).toBe(false);
    expect(isSafelyPrunable("call_logs", { ...confirmedCall, conflict_unresolved: true }, "user-1", new Set(), "2026-01-01T00:00:00.000Z")).toBe(false);
  });

  it("uses a stable 90-day instant cutoff across Asia/Kolkata calendar boundaries", () => {
    const now = new Date("2026-07-29T18:30:00.000+05:30");
    expect(Date.parse(operationalCutoff(now))).toBe(now.getTime() - 90 * 86_400_000);
  });

  it("uses configured operating thresholds rather than browser quota", () => {
    expect(storageStatus(STORAGE_BUDGET.warningBytes)).toBe("warning");
    expect(storageStatus(STORAGE_BUDGET.hardLimitBytes)).toBe("constrained");
    expect(STORAGE_BUDGET.visitImageMaxBytes).toBe(350 * 1024);
  });

  it("contains no Base64 visit persistence path", () => {
    const sources = [
      "src/lib/db.ts",
      "src/lib/fieldVisits/repository.ts",
      "src/app/visits/new/distributor/page.tsx",
      "src/app/visits/new/retailer/page.tsx",
    ].map((file) => fs.readFileSync(path.join(process.cwd(), file), "utf8")).join("\n");
    expect(sources).not.toContain("readAsDataURL");
    expect(sources).not.toContain("mediaBase64");
    expect(sources).not.toContain("fetch(media.media_data)");
  });

  it("keeps login bootstrap bounded while retaining a server-only historical path", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/lib/db.ts"), "utf8");
    expect(source).toContain("recentOperationalWindowDays");
    expect(source).toContain("fetchHistoricalOperationalData");
    expect(source).toContain("Math.min(limit, 100)");
    expect(source).not.toContain('select("*").eq("user_id", userId).range(from, to) },\n  ];');
  });

  it("keeps cleanup bounded, mutexed and free of continuous timers", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/lib/storageCleanup.ts"), "utf8");
    expect(source).toContain("activeCleanup");
    expect(source).toContain("cleanupBatchSize");
    expect(source).not.toContain("setInterval");
    expect(source).toContain("sessionStorage.getItem(sessionKey)");
    expect(source).not.toMatch(/field_visit_media[\s\S]{0,120}bulkDelete/);
  });

  it("removes temporary media only on confirmed visit command response", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/lib/db.ts"), "utf8");
    const confirmation = source.indexOf("returned no confirmed record");
    const mediaDelete = source.indexOf('field_visit_media.where("visit_id").equals(visitId).delete()');
    expect(mediaDelete).toBeGreaterThan(confirmation);
  });

  it("Data Health exposes metadata without private fields or raw payloads", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/app/admin/data-health/page.tsx"), "utf8");
    expect(source).toContain("Estimated CRM local storage");
    expect(source).toContain("IndexedDB table counts");
    expect(source).not.toMatch(/business_name|client_problem|visit_notes|check_in_lat|media_data|command_args|item\.data/);
  });
});
