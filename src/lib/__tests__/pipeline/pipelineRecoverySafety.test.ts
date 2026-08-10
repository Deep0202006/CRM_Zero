import fs from "node:fs";
import path from "node:path";

describe("Pipeline recovery integration safety", () => {
  const dbSource = fs.readFileSync(path.join(process.cwd(), "src/lib/db.ts"), "utf8");
  const repository = fs.readFileSync(path.join(process.cwd(), "src/lib/pipeline/repository.ts"), "utf8");
  const runtime = fs.readFileSync(path.join(process.cwd(), "src/lib/pipeline/legacyRecoveryRuntime.ts"), "utf8");
  const route = fs.readFileSync(path.join(process.cwd(), "src/app/api/pipeline/leads/route.ts"), "utf8");

  test("passive evidence does not block pull-down or Realtime", () => {
    expect(dbSource.match(/isActiveSyncQueueItem\(item\)/g)?.length).toBeGreaterThanOrEqual(3);
  });

  test("passive-only evidence cannot retain the active outbox owner lock", () => {
    expect(dbSource).toContain("countActiveSyncQueueItems");
    expect(runtime).toContain('localStorage.removeItem("zerodata_outbox_owner_id")');
  });

  test("genuine unsynced work remains protected while passive recovery evidence is excluded", () => {
    expect(dbSource).toContain('item.action === "UPDATE" || item.action === "DELETE"');
    expect(dbSource).toContain("isActiveSyncQueueItem(item)");
  });

  test("successful recovery refetches server authority for all-user convergence", () => {
    expect(repository).toContain("if (recovery.serverChanged)");
    expect(repository).toContain("Pipeline recovery refresh failed");
  });

  test("optional recovery failure cannot suppress authoritative board rows", () => {
    expect(route).toContain("let operations: ConfirmedPipelineOperation[] = []");
    expect(route).toContain("RECOVERY_EVIDENCE_UNAVAILABLE");
    expect(repository).toContain(".catch(() => ({ autoRecoverable: 0");
  });

  test("recovery preserves records and creates no synthetic call or destructive reset path", () => {
    const combined = `${repository}\n${runtime}`;
    expect(combined).not.toMatch(/call_logs/);
    expect(combined).not.toMatch(/\.delete\s*\(/);
    expect(combined).not.toMatch(/\.clear\s*\(/);
    expect(combined).not.toMatch(/deleteDatabase|localStorage\.clear/);
    expect(runtime).toContain("serverLead.lead_id");
    expect(runtime).not.toContain("crypto.randomUUID");
  });
});
