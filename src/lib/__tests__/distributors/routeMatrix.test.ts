import fs from "fs";
import path from "path";

describe("critical Payment and Distributor route matrix", () => {
  const routes = ["src/app/admin/payments/page.tsx", "src/app/admin/payments/distributors/page.tsx", "src/app/payments/page.tsx", "src/app/payments/distributors/page.tsx"];
  test.each(routes)("%s exists as a page", (route) => expect(fs.existsSync(path.join(process.cwd(), route))).toBe(true));
  test("navigation retains both role-specific authorities", () => {
    const navigation = fs.readFileSync(path.join(process.cwd(), "src/components/DashboardLayout.tsx"), "utf8");
    for (const href of ["/admin/payments", "/payments", "/admin/payments/distributors", "/payments/distributors"]) expect(navigation).toContain(href);
  });
  test("Distributor pages retain their server routes", () => {
    for (const route of ["src/app/api/distributors/route.ts", "src/app/api/distributors/metrics/route.ts", "src/app/api/distributors/commands/route.ts"]) expect(fs.existsSync(path.join(process.cwd(), route))).toBe(true);
  });
  test("Payment Collection and Distributor Status reuse one employee authority", () => {
    for (const file of ["src/app/api/receivables/admin/route.ts", "src/app/api/distributors/metrics/route.ts", "src/lib/distributors/importServer.ts"]) {
      expect(fs.readFileSync(path.join(process.cwd(), file), "utf8")).toContain("listEligibleOperationalEmployees");
    }
  });
});
