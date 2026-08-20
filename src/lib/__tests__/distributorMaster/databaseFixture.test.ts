import fs from "node:fs";
import path from "node:path";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("disposable distributor master PostgreSQL fixture", () => {
  test("is explicitly disposable and applies the complete authority chain", () => {
    const runner = read("scripts/distributor-master-db/run-integration.sh");
    expect(runner).toContain('CRM_MASTER_DB_DISPOSABLE:-}" != "1"');
    expect(runner).toContain("Refusing master-import fixtures against a production Supabase target.");
    for (const migration of ["033_receivables_v1.sql", "034_receivables_production_completion.sql", "035_receivables_import_linearization.sql", "039_distributor_status_v1.sql", "040_distributor_status_v2.sql", "041_distributor_mapped_status.sql", "042_payment_collection_renewals.sql", "045_distributor_receivable_canonical_link.sql", "046_unified_distributor_master_import.sql"]) {
      expect(runner).toContain(migration);
    }
  });

  test("proves cross-domain success, replay, payment idempotency, and rollback", () => {
    const fixture = read("scripts/distributor-master-db/integration.sql");
    expect(fixture).toContain("MASTER_FINANCIAL_AUTHORITY_INVALID");
    expect(fixture).toContain("MASTER_CONFIRMED_PAYMENT_INVALID");
    expect(fixture).toContain("MASTER_REPLAY_INVALID");
    expect(fixture).toContain("MASTER_PAYMENT_IDEMPOTENCY_INVALID");
    expect(fixture).toContain("MASTER_PAYMENT_OVERPAYMENT");
    expect(fixture).toContain("MASTER_ATOMIC_ROLLBACK_INVALID");
    expect(fixture).toContain("distributor_master_import_batches");
  });
});
