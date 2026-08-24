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

  it("preserves the mapping requester separately and credits the completing user", () => {
    expect(dbSource).toContain("requested_by?: string | null");
    expect(mappingsPage).toContain("requested_by: currentUser?.user_id || null");
    expect(mappingsPage).toContain("mapped_by: null");
    expect(mappingsPage).toContain("updates.mapped_by = currentUser?.user_id || null");
  });
});
