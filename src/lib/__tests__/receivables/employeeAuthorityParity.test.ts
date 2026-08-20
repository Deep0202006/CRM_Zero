jest.mock("server-only", () => ({}), { virtual: true });

import { buildImportPreview } from "@/lib/receivables/importServer";
import { buildDistributorImportPreview } from "@/lib/distributors/importServer";
import type { ImportRow } from "@/lib/receivables/import";
import type { DistributorImportRow } from "@/lib/distributors/import";

const employee = {
  user_id: "20000000-0000-4000-a000-000000000001",
  name: "Employee",
  email: "employee-alias",
  is_active: true,
};
const loginEmail = "employee@example.com";

function service() {
  return {
    auth: {
      admin: {
        listUsers: jest.fn().mockResolvedValue({
          data: { users: [{ id: employee.user_id, email: loginEmail }] },
          error: null,
        }),
      },
    },
    rpc: jest.fn().mockImplementation(
      (
        _function: string,
        args: {
          p_rows: Array<{
            row_number: number;
            distributor_name: string;
            distributor_code: string;
          }>;
        },
      ) =>
        Promise.resolve({
          data: args.p_rows.map((row) => ({
            row_number: row.row_number,
            distributor_id: "40000000-0000-4000-a000-000000000001",
            distributor_name: row.distributor_name,
            distributor_reference: row.distributor_code,
            resolution: "RESOLVED",
          })),
          error: null,
        }),
    ),
    from(table: string) {
      const result =
        table === "users"
          ? { data: [employee], error: null }
          : { data: [], error: null };
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        range: () => Promise.resolve(result),
        in: () => Promise.resolve(result),
      };
      return builder;
    },
  } as never;
}

describe("shared employee authority parity", () => {
  test("Payment and Distributor imports resolve mixed-case employee email identically", async () => {
    const payment: ImportRow = {
      rowNumber: 2,
      billReference: "INV-1",
      distributorName: "Alpha",
      distributorCode: "ALPHA",
      contactPerson: "Person",
      contactPhone: "999",
      billAmount: "100.00",
      billDueDate: "2099-01-01",
      nextFollowUpDate: "2099-01-01",
      assignedEmployeeEmail: loginEmail,
      notes: "",
    };
    const distributor: DistributorImportRow = {
      rowNumber: 2,
      distributorName: "Alpha",
      erpName: "MARG",
      assignedEmployeeEmail: loginEmail,
      installationStatus: "pending",
      installationDate: "",
      trainingStatus: "pending",
      trainingDate: "",
      mappingStatus: "pending",
      mappedDate: "",
      activityStatus: "not_applicable",
      billingStatus: "not_billed",
      billDate: "",
      billReference: "",
      renewalDate: "",
      distributorReference: "ALPHA",
    };
    const [paymentPreview, distributorPreview] = await Promise.all([
      buildImportPreview(service(), "30000000-0000-4000-a000-000000000001", [
        payment,
      ]),
      buildDistributorImportPreview(
        service(),
        "30000000-0000-4000-a000-000000000002",
        [distributor],
      ),
    ]);
    expect(paymentPreview.rows[0]).toMatchObject({
      classification: "NEW",
      assigned_to: employee.user_id,
    });
    expect(distributorPreview.rows[0]).toMatchObject({
      classification: "NEW",
      payload: { assigned_to: employee.user_id },
    });
  });
});
