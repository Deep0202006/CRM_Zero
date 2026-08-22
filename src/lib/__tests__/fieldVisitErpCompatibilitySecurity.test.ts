import fs from "fs";
import path from "path";
import type { LocalFieldVisit } from "@/lib/db";
import { buildFieldVisitConfirmPayload } from "@/lib/fieldVisits/sync";

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");
const json = <T>(relative: string) => JSON.parse(read(relative)) as T;

describe("Field Visit ERP compatibility, security, and engineering knowledge", () => {
  it("preserves the pre-contract queued shape and same visit identity", () => {
    const legacy: LocalFieldVisit = {
      visit_id: "00000000-0000-4000-8000-000000000010", lead_id: "legacy-business", user_id: "00000000-0000-4000-8000-000000000001",
      visit_date: "2026-08-21", check_in_time: "2026-08-21T04:00:00.000Z", check_in_lat: null, check_in_lng: null,
      check_in_photo_url: null, visit_outcome: "interested", visit_notes: null, created_at: "2026-08-21T04:00:00.000Z", updated_at: "2026-08-21T04:00:00.000Z",
    };
    const payload = buildFieldVisitConfirmPayload(legacy);
    expect(payload.visit_id).toBe(legacy.visit_id);
    expect(payload).not.toHaveProperty("erp_contract_version");
    expect(payload).not.toHaveProperty("erp_usage_state");
    expect(payload).not.toHaveProperty("erp_id");
  });

  it("keeps ERP reads authenticated/capability-scoped and database writes service-only", () => {
    const options = read("src/app/api/field-visits/erp-options/route.ts");
    const analytics = read("src/app/api/admin/visits/erp-analytics/route.ts");
    const migration = read("supabase/migrations/048_field_visit_erp_observation.sql");
    expect(options).toContain("auth.auth.getUser(token)");
    expect(options).toContain('["field_ret", "field_dist", "admin"]');
    expect(analytics).toContain('row.capability_code === "admin"');
    for (const signature of ["confirm_field_visit_erp_v1(uuid,jsonb)", "field_visit_erp_intelligence_v1()"]) {
      expect(migration).toContain(`revoke all on function public.${signature} from public,anon,authenticated`);
      expect(migration).toContain(`grant execute on function public.${signature} to service_role`);
    }
    expect(migration).not.toMatch(/grant execute on function public\.(confirm_field_visit_erp_v1|field_visit_erp_intelligence_v1)[^;]+authenticated/i);
  });

  it("records one authority, its reusable capability, and durable lessons", () => {
    const authorities = json<{ facts: Array<Record<string, unknown>> }>("docs/engineering/AUTHORITIES.json").facts;
    const capabilities = json<{ capabilities: Array<Record<string, unknown>> }>("docs/engineering/CAPABILITIES.json").capabilities;
    const lessons = json<{ lessons: Array<{ id: string; rule: string }> }>("docs/engineering/LESSONS.json").lessons;
    const authority = authorities.filter((fact) => fact.id === "field_visit_erp_observation");
    expect(authority).toHaveLength(1);
    expect(authority[0]).toMatchObject({ authority: "public.field_visits(erp_usage_state, erp_id)", writer: "service-only public.confirm_field_visit_erp_v1 transaction" });
    expect(capabilities.filter((capability) => capability.id === "field-visit-erp-intelligence")).toHaveLength(1);
    expect(lessons).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "ERP_AUTHORITIES", rule: expect.stringContaining("None is not Not captured") }),
      expect.objectContaining({ id: "OFFLINE_COMPATIBILITY" }),
    ]));
  });

  it("does not introduce protected-domain mutation statements", () => {
    const migration = read("supabase/migrations/048_field_visit_erp_observation.sql");
    expect(migration).not.toMatch(/(?:insert\s+into|update|delete\s+from)\s+public\.(distributor_accounts|leads|call_logs|receivables|receivable_payments)/i);
  });
});
