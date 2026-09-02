import fs from "node:fs";
import path from "node:path";

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

describe("Owner user-retirement artifacts", () => {
  const precheck = read("supabase/manual/precheck_ravi_prince_retirement.sql");

  it("is read-only, resolves exact names, checks Auth drift, and discovers UUID dependencies", () => {
    expect(precheck).toMatch(/begin read only/i);
    expect(precheck).toContain("lower(btrim(name)) in ('ravi', 'prince')");
    expect(precheck).toContain("expected exactly one Ravi and one Prince profile");
    expect(precheck).toContain("left join auth.users");
    expect(precheck).toContain("information_schema.columns");
    expect(precheck).toContain("RETIREMENT_DEPENDENCY");
    expect(precheck).toContain("constraint_info.confrelid = 'public.users'::regclass");
    expect(precheck).toMatch(/rollback;/i);
  });

  it("contains no durable data or schema mutation", () => {
    expect(precheck).not.toMatch(/delete\s+from\s+(?:public|auth)\./i);
    expect(precheck).not.toMatch(/update\s+(?:public|auth)\./i);
    expect(precheck).not.toMatch(/insert\s+into\s+(?:public|auth)\./i);
    expect(precheck).not.toMatch(/create\s+(?:temporary\s+)?table|alter\s+table|drop\s+table|truncate/i);
  });

  it("removes generic personal-name examples without touching business fixtures", () => {
    expect(read("src/components/admin/CreateUserPanel.tsx")).not.toMatch(/Prince K|zerodata_prince/);
    expect(read("src/lib/__tests__/visualIntelligence.test.ts")).not.toMatch(/name:\s*["']Ravi["']/);
  });
});
