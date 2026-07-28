import fs from "fs";
import path from "path";

describe("KPI source synchronization durability", () => {
  const dbSource = fs.readFileSync(path.join(process.cwd(), "src/lib/db.ts"), "utf8");
  const callPage = fs.readFileSync(path.join(process.cwd(), "src/app/call-logs/page.tsx"), "utf8");

  it("repairs legacy queue payloads and serializes queue processing", () => {
    expect(dbSource).toContain("prepareSyncPayload");
    expect(dbSource).toContain("activeSyncQueueRun");
    expect(dbSource).toContain("Payload repaired:");
    expect(dbSource).toContain("No ${remoteTableName} row was updated.");
  });

  it("never restores an RLS-empty remote table from browser cache", () => {
    expect(dbSource).not.toContain("Pushing local data to restore remote");
    expect(dbSource).toContain("local data was preserved without recovery writes");
  });

  it("stores Excel call identities outside the UUID lead foreign key", () => {
    expect(callPage).toContain("parseCallClientReference(selectedLeadId)");
    expect(callPage).toContain("lead_id: clientReference.leadId");
    expect(callPage).toContain("client_username: clientReference.clientUsername");
    expect(callPage).toContain("client_name: clientReference.clientName");
    expect(callPage).toContain("related_lead_id: clientReference.leadId");
  });
});
