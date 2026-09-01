import fs from "fs";
import path from "path";

describe("Team KPI source workflow attribution", () => {
  const mappingsPage = fs.readFileSync(
    path.join(process.cwd(), "src/app/mappings/page.tsx"),
    "utf8",
  );
  const dbSource = fs.readFileSync(
    path.join(process.cwd(), "src/lib/db.ts"),
    "utf8",
  );
  const migration = fs.readFileSync(
    path.join(process.cwd(), "supabase/migrations/054_creator_updates_billed_erp_payment.sql"),
    "utf8",
  );

  it("preserves requester audit identity and generates completion attribution server-side", () => {
    expect(dbSource).toContain("requested_by?: string | null");
    expect(mappingsPage).toContain("mapping.requested_by === currentUser?.user_id");
    expect(dbSource).toContain("queueMappingOwnerUpdate");
    expect(migration).toContain("new.requested_by := actor");
    expect(migration).toContain("new.mapped_by := actor");
  });
});
