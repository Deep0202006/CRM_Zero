import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8");

describe("retired employee identity-erasure policy", () => {
  const lifecycle = read("docs/contracts/DATA_LIFECYCLE.md");
  const contract = read("docs/contracts/IDENTITY_ERASURE.md");
  const authorities = read("docs/engineering/AUTHORITIES.json");
  const domains = read("docs/engineering/DOMAIN_MAP.json");

  it("keeps Class-A permanence as the default and narrows the exception", () => {
    expect(lifecycle).toContain("ordinary product or Admin features cannot delete it");
    expect(contract).toContain("Class A business history is permanent");
    expect(contract).toContain("manual and one-time");
    expect(contract).toContain("freezes every target as an exact `public.users.user_id` UUID");
  });

  it("requires dry-run-first, production-Owner-only, fail-closed execution", () => {
    expect(contract).toContain("production Owner authorizes that exact operation");
    expect(contract).toContain("approve a dry-run receipt");
    expect(contract).toContain("Production execution is Owner-only");
    expect(contract).toContain("aborts on an unknown table/column");
    expect(contract).toContain("Auth drift");
    expect(contract).toContain("Codex and CI");
    expect(authorities).toContain('"id": "retired_employee_identity_erasure_operation"');
    expect(authorities).toContain('"wholeResource": true');
    expect(domains).toContain("supabase/manual/execute_ravi_prince_identity_erasure.sql");
    expect(domains).toContain('"retired_employee_identity_erasure_operation"');
  });

  it("preserves independent authorities and deletes only target-exclusive rows", () => {
    expect(contract).toContain("Independent business authorities survive");
    expect(contract).toContain("Leads and Client Queries remain");
    expect(contract).toContain("Task assigned to an active non-target employee remains");
    expect(contract).toContain("target-exclusive employee data may be deleted only by exact frozen identifiers");
    expect(contract).toContain("must never delete its referenced Lead");
  });

  it("forbids a generic app deletion endpoint while allowing provisioning rollback", () => {
    const apiRoot = path.join(root, "src/app/api");
    const routeFiles: string[] = [];
    const visit = (directory: string) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) visit(target);
        else if (entry.name === "route.ts") routeFiles.push(target);
      }
    };
    visit(apiRoot);

    expect(fs.existsSync(path.join(apiRoot, "admin/delete-user/route.ts"))).toBe(false);
    expect(read("src/app/admin/page.tsx")).not.toMatch(/handleDeleteUser|\/api\/admin\/delete-user/);
    for (const routeFile of routeFiles) {
      const source = fs.readFileSync(routeFile, "utf8");
      expect(source).not.toMatch(/export async function DELETE[\s\S]*auth\.admin\.deleteUser/);
    }
    expect(read("src/app/api/admin/create-user/route.ts")).toContain("auth.admin.deleteUser(newUser.user.id)");
    expect(contract).toContain("No `DELETE USER` application route");
  });

  it("neutralizes only fictional employee placeholders", () => {
    expect(read("src/components/admin/CreateUserPanel.tsx")).not.toMatch(/Prince K|zerodata_prince/i);
    expect(read("src/lib/__tests__/visualIntelligence.test.ts")).not.toMatch(/name: "Ravi"/);
  });
});
