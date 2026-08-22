import fs from "fs";
import path from "path";

const read = (name: string) => fs.readFileSync(path.join(process.cwd(), "scripts/field-business-erp-db", name), "utf8");
const fixture = read("pre-049.sql");
const matrix = read("verify.sql");
const runner = read("run-integration.sh");
const workflow = fs.readFileSync(path.join(process.cwd(), ".github/workflows/harness.yml"), "utf8");

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

  it("emits a durable exact-head PostgreSQL 17 artifact only after the matrix passes", () => {
    expect(runner.indexOf("verify.sql")).toBeLessThan(runner.indexOf("result=PASS"));
    expect(runner).toContain("GITHUB_SHA");
    expect(runner).toContain("migration049_sha256");
    expect(runner).toContain("matrix_sha256");
    expect(workflow).toContain("CRM_P1_049_PROOF_PATH");
    expect(workflow).toContain("actions/upload-artifact@v4");
    expect(workflow).toContain("crm-p1-049-postgres17-${{ github.event.pull_request.head.sha }}");
    expect(workflow).toContain("if-no-files-found: error");
  });
});
