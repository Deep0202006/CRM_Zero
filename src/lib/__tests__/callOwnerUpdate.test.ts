import fs from "node:fs";
import path from "node:path";
import { callOwnerUpdateSchema, hasCanonicalCallClientReference } from "@/lib/callLogs/serverContract";

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");
const business = { lead_id: null, client_username: "client-a", client_name: "Client A", outcome: "Requested more info", notes: "Changed", next_followup_date: "2026-09-03" };

describe("Call creator update contract", () => {
  test("accepts only mutable business facts and preserves one outcome authority", () => {
    expect(callOwnerUpdateSchema.safeParse(business).success).toBe(true);
    for (const immutable of ["log_id", "user_id", "timestamp"]) expect(callOwnerUpdateSchema.safeParse({ ...business, [immutable]: "poison" }).success).toBe(false);
    expect(callOwnerUpdateSchema.safeParse({ ...business, outcome: "Pipeline stage transition" }).success).toBe(false);
    expect(hasCanonicalCallClientReference(business)).toBe(true);
    expect(hasCanonicalCallClientReference({ ...business, client_username: null })).toBe(false);
  });

  test("server derives identity, rejects non-owner and has no Admin override", () => {
    const route = read("src/app/api/call-logs/[log_id]/route.ts");
    expect(route).toContain("service.auth.getUser(token)");
    expect(route).toContain('existing.data.user_id !== auth.user.id');
    expect(route).toContain('code: "CALL_UPDATE_NOT_OWNER"');
    expect(route).toContain('isSyntheticAuditCall(existing.data)');
    expect(route).toContain('.eq("log_id", log_id).eq("user_id", auth.user.id)');
    expect(route).not.toMatch(/isAdmin|capability_code|has_capability/);
  });

  test("pending and confirmed edits retain the same log ID and durable queue identity", () => {
    const database = read("src/lib/db.ts");
    expect(database).toContain('equals(`call-log:${log.log_id}`)');
    expect(database).toContain('pendingInsert.action === "INSERT"');
    expect(database).toContain('upsertStableUpdate(`call-update:${log.log_id}`');
    expect(database).toContain('fetch(`/api/call-logs/${encodeURIComponent(logId)}`');
    expect(database).not.toMatch(/call_logs\.(?:delete|clear|bulkDelete)\s*\(/);
  });

  test("only the exact creator row receives the Update control", () => {
    const page = read("src/app/call-logs/page.tsx");
    expect(page).toContain('log.user_id === currentUser?.user_id && !isSyntheticAuditCall(log)');
    expect(page).toContain('editingLog.user_id !== currentUser.user_id');
    expect(page).toContain("queueCallOwnerUpdate(updated, followUpTasks)");
  });
});
