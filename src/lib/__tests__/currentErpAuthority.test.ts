import fs from "fs";
import path from "path";

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), "utf8");
const json = <T>(relative: string) => JSON.parse(read(relative)) as T;

describe("Current business ERP authority and compatibility", () => {
  it("registers exactly one separate manual-baseline authority", () => {
    const facts = json<{ facts: Array<Record<string, unknown>> }>("docs/engineering/AUTHORITIES.json").facts;
    const baseline = facts.filter((fact) => fact.id === "field_business_erp_baseline");
    expect(baseline).toHaveLength(1);
    expect(baseline[0]).toMatchObject({
      authority: "public.field_business_erp_baselines",
      identity: ["segment_type", "business_ref"],
    });
    expect(baseline[0].mustNotOwn).toEqual(expect.arrayContaining([
      "Field Visit history or visit-time ERP observation",
      "Distributor canonical ERP assignment",
      "financial facts",
    ]));
  });

  it("keeps manual baseline separate from historical observation", () => {
    const lessons = json<{ lessons: Array<{ id: string; rule: string }> }>("docs/engineering/LESSONS.json").lessons;
    expect(lessons).toContainEqual(expect.objectContaining({
      id: "ERP_AUTHORITIES",
      rule: expect.stringContaining("baseline never rewrites history"),
    }));
  });

  it("binds the reusable ERP capability to both observation and baseline authorities", () => {
    const capabilities = json<{ capabilities: Array<Record<string, unknown>> }>("docs/engineering/CAPABILITIES.json").capabilities;
    const capability = capabilities.find((item) => item.id === "field-visit-erp-intelligence");
    expect(capability?.authorityRefs).toEqual(expect.arrayContaining([
      "erp_system", "field_visit_erp_observation", "field_business_erp_baseline",
    ]));
  });

  it("preserves V1 compatibility and service-only security in Migration 049", () => {
    const migration = read("supabase/migrations/049_field_business_erp_baseline.sql");
    expect(migration).not.toMatch(/create\s+or\s+replace\s+function\s+public\.field_visit_erp_intelligence_v1/i);
    expect(migration).not.toMatch(/(?:insert\s+into|update|delete\s+from)\s+public\.field_visits/i);
    for (const signature of ["set_field_business_erp_baselines_v1(uuid,jsonb)", "field_business_erp_current_v2(text,text,integer)", "field_visit_erp_intelligence_v2()"])
      expect(migration).toContain(`revoke all on function public.${signature} from public,anon,authenticated`);
    expect(migration).not.toMatch(/grant execute on function public\.(set_field_business_erp_baselines_v1|field_business_erp_current_v2|field_visit_erp_intelligence_v2)[^;]+authenticated/i);
  });
});
