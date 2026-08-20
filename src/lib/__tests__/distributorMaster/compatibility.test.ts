import fs from "node:fs";
import path from "node:path";
import { normalizeDistributorFinancialProjectionRow } from "@/lib/distributors/domain";

const read = (file: string) =>
  fs.readFileSync(path.join(process.cwd(), file), "utf8");
const migration = read(
  "supabase/migrations/046_unified_distributor_master_import.sql",
);
const distributorPage = read("src/app/admin/payments/distributors/page.tsx");
const distributorImport = read(
  "src/components/distributors/DistributorImportModal.tsx",
);
const receivablesPage = read("src/app/admin/payments/page.tsx");
const employeePaymentsPage = read("src/app/payments/page.tsx");
const migrationSchemaPrefix = migration.slice(
  0,
  migration.indexOf(
    "create or replace function public.apply_distributor_master_payments_v1",
  ),
);
const distributorAuthority = read(
  "supabase/migrations/041_distributor_mapped_status.sql",
);

describe("unified master import compatibility", () => {
  test("keeps the certified legacy import authorities independent", () => {
    expect(migration).toContain("public.distributor_status_command_v1(");
    expect(migration).toContain("public.import_receivables_v1(");
    expect(migration).not.toMatch(
      /create\s+or\s+replace\s+function\s+public\.import_distributor_status_v1/i,
    );
    expect(migration).not.toMatch(
      /create\s+or\s+replace\s+function\s+public\.import_receivables_v1/i,
    );
    expect(distributorAuthority).toContain(
      "create or replace function public.import_distributor_status_v1",
    );
    expect(distributorPage).toContain("<DistributorImportModal");
    expect(distributorImport).toContain('"/api/distributors/import"');
    expect(receivablesPage).toContain("<ReceivablesImportModal");
    expect(receivablesPage).toContain("Import Spreadsheet");
  });

  test("retains manual canonical Receivable creation and exact payment commands", () => {
    expect(receivablesPage).toContain("<ReceivablesCreateModal");
    expect(receivablesPage).toContain("New Receivable");
    expect(distributorPage).toContain("<ReceivablesCreateModal");
    expect(distributorPage).toMatch(/operation_type:\s*"create"/);
    expect(distributorPage).toMatch(
      /<AdminReceivableActionModal\s+action="direct_payment"/,
    );
    expect(distributorPage).toMatch(/operation_type:\s*"direct_payment"/);
    expect(distributorPage).toMatch(/receivable_id:\s*paymentTarget\.receivable_id/);
    expect(distributorPage).toMatch(/expected_version:\s*paymentTarget\.version/);
  });

  test("retains employee reported-payment semantics and canonical renewal commands", () => {
    expect(employeePaymentsPage).toContain(
      'selected.action==="payment_report"',
    );
    expect(employeePaymentsPage).toContain("operation_type:selected.action");
    expect(employeePaymentsPage).toContain(
      "Payment awaiting verification. Confirmed outstanding is unchanged.",
    );
    expect(distributorPage).toMatch(
      /value\.action === "renew"[\s\S]*\? "renew"[\s\S]*: "update"/,
    );
    expect(distributorPage).toMatch(/expected_version:\s*editing!\.version/);
    expect(distributorPage).toMatch(/renewal_date:\s*value\.renewal_date/);
  });

  test("preserves the PR61 PostgreSQL numeric JSON wire contract", () => {
    expect(
      normalizeDistributorFinancialProjectionRow({
        total_bill_amount: 1000,
        confirmed_collected_amount: 400,
        outstanding_amount: 600.5,
      }),
    ).toMatchObject({
      total_bill_amount: "1000.00",
      confirmed_collected_amount: "400.00",
      outstanding_amount: "600.50",
    });
    expect(distributorPage).toMatch(
      /formatInr\(row\.confirmed_collected_amount\s*\?\?\s*"0.00"\)/,
    );
    expect(distributorPage).toMatch(
      /formatInr\(row\.outstanding_amount\s*\?\?\s*"0.00"\)/,
    );
    expect(migration).toContain("v_amount numeric(14,2)");
    expect(migration).toContain("amount numeric(14,2) not null");
  });

  test("adds master payment identity without a financial-row backfill", () => {
    expect(migration).toMatch(
      /alter table public\.receivable_payments\s+add column import_key text/i,
    );
    expect(migrationSchemaPrefix).not.toMatch(
      /update\s+public\.(?:receivables|receivable_payments)\b/i,
    );
    expect(migrationSchemaPrefix).not.toMatch(
      /delete\s+from\s+public\.(?:receivables|receivable_payments)\b/i,
    );
    expect(migration).toContain(
      "where r.receivable_id=b.receivable_id and r.receivable_id=s.receivable_id",
    );
  });
});
