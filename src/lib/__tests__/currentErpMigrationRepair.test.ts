import fs from "fs";
import path from "path";

const migration = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/049_field_business_erp_baseline.sql"), "utf8");

describe("Migration 049 nullable unknown and captured-fact recency repair", () => {
  it("publishes the stable Admin batch RPC argument contract", () => {
    expect(migration).toMatch(/set_field_business_erp_baselines_v1\(\s*p_actor_id uuid,\s*p_rows jsonb\s*\)/);
    expect(migration).not.toContain("p_operations");
  });

  it("permits only the compatible NULL/NULL unknown pair", () => {
    expect(migration).toContain("erp_usage_state text null check (erp_usage_state is null or erp_usage_state in ('erp','none'))");
    expect(migration).toContain("(erp_usage_state is null and erp_id is null)");
    expect(migration).toContain("or (erp_usage_state='erp' and erp_id is not null)");
    expect(migration).toContain("or (erp_usage_state='none' and erp_id is null)");
  });

  it("keeps all visited identities but admits only captured visit facts to both recency competitions", () => {
    expect(migration.match(/with businesses as \([\s\S]*?where f\.segment_type in \('Retailer','Distributor'\)[\s\S]*?\), visit_latest/g)).toHaveLength(2);
    expect(migration.match(/visit_latest as \([\s\S]*?f\.erp_usage_state in \('erp','none'\)[\s\S]*?order by/g)).toHaveLength(2);
    expect(migration.match(/[xb]\.erp_usage_state in \('erp','none'\)/g)).toHaveLength(2);
  });

  it("does not rewrite history or replace V1 compatibility authority", () => {
    expect(migration).not.toMatch(/(?:insert\s+into|update|delete\s+from)\s+public\.field_visits/i);
    expect(migration).not.toMatch(/create\s+or\s+replace\s+function\s+public\.field_visit_erp_intelligence_v1/i);
  });
});
