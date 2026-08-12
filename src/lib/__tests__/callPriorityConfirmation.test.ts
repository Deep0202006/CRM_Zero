import fs from "fs";
import path from "path";

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");

describe("priority call confirmation incident contract", () => {
  const database = read("src/lib/db.ts");
  const page = read("src/app/call-logs/page.tsx");

  it("selects one exact outbox item independently of the general backlog", () => {
    const priorityStart = database.indexOf("export async function confirmQueuedCallLog");
    const generalStart = database.indexOf("async function processSyncQueueInternal");
    const priority = database.slice(priorityStart, generalStart);
    expect(priorityStart).toBeGreaterThan(-1);
    expect(priority).toContain('const idempotencyKey = `call-log:${logId}`');
    expect(priority).toContain('.where("idempotency_key").equals(idempotencyKey).first()');
    expect(priority).toContain("await confirmCallLog(prepared.data, accessToken)");
    expect(priority).not.toContain('orderBy("id").toArray()');
  });

  it("removes only the exact queue item after matching server confirmation", () => {
    const confirmation = database.indexOf("await confirmCallLog(prepared.data, accessToken)");
    const exactCheck = database.indexOf("current?.idempotency_key === idempotencyKey", confirmation);
    const removal = database.indexOf("await db.sync_queue.delete(item.id)", exactCheck);
    expect(confirmation).toBeGreaterThan(-1);
    expect(exactCheck).toBeGreaterThan(confirmation);
    expect(removal).toBeGreaterThan(exactCheck);
  });

  it("shows the durable call immediately and drains older work once in background", () => {
    const localSave = page.indexOf('await db.call_logs.add(log)');
    const localDisplay = page.indexOf("setLogs((current)", localSave);
    const targeted = page.indexOf("await confirmQueuedCallLog(logId)", localDisplay);
    const background = page.indexOf("void processSyncQueueExcept(`call-log:${logId}`)", targeted);
    expect(localSave).toBeGreaterThan(-1);
    expect(localDisplay).toBeGreaterThan(localSave);
    expect(targeted).toBeGreaterThan(localDisplay);
    expect(background).toBeGreaterThan(targeted);
    expect(page.slice(localSave, background).match(/processSyncQueue(?:Except)?\(/g) ?? []).toHaveLength(0);
    expect(page.slice(localSave).match(/processSyncQueueExcept\(/g) ?? []).toHaveLength(1);
    expect(page.slice(localSave, background)).not.toContain("await loadData()");
    expect(page).toContain("const refreshAuthority = () => void loadData(false)");
    expect(page).toContain("const refreshOnFocus = () => void loadData()");
    expect(database).toContain("temporarilyExcludedSyncKeys.has(item.idempotency_key)");
  });

  it("keeps the same call ID through local record, idempotency key, and confirmation", () => {
    expect(page).toContain("log_id: logId");
    expect(page).toContain('idempotency_key: `call-log:${logId}`');
    expect(database).toContain("result.log_id !== payload.log_id");
  });

  it("does not endlessly retry a permanently invalid retained call", () => {
    const route = read("src/app/api/call-logs/confirm/route.ts");
    expect(route).toContain('code: "CALL_REFERENCE_INVALID"');
    expect(route).toContain("referenceInvalid ? 422 : 500");
    expect(database).toContain("response.status === 408 || response.status === 429 || response.status >= 500");
    expect(database).toContain('recovery_reason: "PERMANENT_CALL_CONFIRMATION_FAILURE"');
    expect(route.indexOf("schema.safeParse(input)")).toBeLessThan(route.indexOf("service.auth.getUser(token)"));
  });
});
