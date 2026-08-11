import fs from "fs"; import path from "path";
const root = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
describe("receivables financial boundary", () => {
  test("migration has preservation, RLS, service-only commands and no DELETE", () => {
    const sql = read("supabase/migrations/033_receivables_v1.sql");
    expect(sql).toMatch(/numeric\(14,2\)/i); expect(sql).toMatch(/enable row level security/gi);
    expect(sql).toMatch(/grant execute.*service_role/i); expect(sql).not.toMatch(/delete\s+from\s+public\.receivable/i);
    expect(sql).toMatch(/on delete restrict/gi); expect(sql).toMatch(/operation_mismatch/i);
  });
  test("browser/domain code cannot mutate financial or legacy tables", () => {
    const files = ["src/app/payments/page.tsx", "src/app/admin/payments/page.tsx", "src/components/PaymentCollectionsPriorityPanel.tsx"];
    for (const file of files) { const source = read(file); expect(source).not.toMatch(/\.from\(["']receivable/); expect(source).not.toMatch(/service.role|SUPABASE_SERVICE_ROLE_KEY/); }
    const domain = fs.readdirSync(path.join(root, "src/lib/receivables")).filter(f => f.endsWith(".ts")).map(f => read(`src/lib/receivables/${f}`)).join("\n");
    expect(domain).not.toMatch(/from\(["'](?:tasks|call_logs|field_visits|lead_payment_details|chat_push_subscriptions)/);
    expect(domain).not.toContain("buildSelfScheduledFollowUpTask"); expect(domain).not.toContain("followUpsToday");
  });
  test("My Day has a dedicated panel before generic queues", () => {
    const page = read("src/app/my-day/page.tsx");
    expect(page).toContain("PaymentCollectionsPriorityPanel");
    expect(page.indexOf("<PaymentCollectionsPriorityPanel")).toBeLessThan(page.indexOf("followUpsToday.length"));
  });
});
