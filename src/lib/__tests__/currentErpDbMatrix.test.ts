import fs from "fs";
import path from "path";

const read = (name: string) => fs.readFileSync(path.join(process.cwd(), "scripts/field-business-erp-db", name), "utf8");
const fixture = read("pre-049.sql");
const matrix = read("verify.sql");
const runner = read("run-integration.sh");
const workflow = fs.readFileSync(path.join(process.cwd(), ".github/workflows/product-verification.yml"), "utf8");
const proofs = JSON.parse(fs.readFileSync(path.join(process.cwd(), "docs/engineering/PROOFS.json"), "utf8")).proofs;

describe("Migration 049 disposable PostgreSQL matrix", () => {
  it("fixtures repeat identities, segment overlap, canonical ERP, and protected sentinels", () => {
    expect(fixture.match(/'repeat-retailer'/g)).toHaveLength(2);
    expect(fixture.match(/'shared-business'/g)).toHaveLength(2);
    expect(fixture).toContain("'Retailer','erp','60000000-0000-4000-a000-000000000001'");
  });

  it("explicitly covers the required authority, editing, recency, and reconciliation cases", () => {
    for (const marker of [
      "EXISTING_CUSTOM_NONE_FAILED", "NON_ADMIN_NOT_DENIED", "BATCH_MAX_NOT_ENFORCED",
      "INVALID_BATCH_WAS_PARTIAL", "BASELINE_RECENCY_FAILED", "VISIT_RECENCY_FAILED",
      "UNKNOWN_COMPETED_AS_FACT", "CLEAR_OR_NOT_CAPTURED_FAILED", "SEGMENT_SEPARATION_FAILED",
      "UNIQUENESS_OR_RECONCILIATION_FAILED", "DIRECT_AUTHENTICATED_DENIAL_FAILED",
      "BASELINE_MUTATED_V1_AUTHORITY", "CROSS_AUTHORITY_MUTATION",
    ]) expect(matrix).toContain(marker);
    expect(matrix).toContain("p_actor_id=>a,p_rows=>");
    expect(matrix).toContain("jsonb_array_elements(v2->'Retailer'->'categories')");
  });

  it("runs the PostgreSQL 17 matrix before declaring the integration result", () => {
    expect(runner.indexOf("verify.sql")).toBeLessThan(runner.indexOf("result=PASS"));
    expect(proofs.find((proof: { id: string }) => proof.id === "erp-postgres")?.paths).toContain("scripts/field-business-erp-db/run-integration.sh");
    expect(proofs.find((proof: { id: string }) => proof.id === "control-postgres-matrix")?.paths).toContain("scripts/field-business-erp-db/run-integration.sh");
    expect(workflow).toContain("postgres:17.6-alpine");
    expect(workflow).toContain("proof-runner.mjs --proof control-postgres-matrix");
    expect(workflow).toContain("kernel-postgres");
  });
});
