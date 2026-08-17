jest.mock("server-only", () => ({}), { virtual: true });

import { listEligibleOperationalEmployees } from "@/lib/employees/server";
import { buildDistributorImportPreview } from "@/lib/distributors/importServer";
import { buildImportPreview } from "@/lib/receivables/importServer";

function service(users: Array<Record<string, unknown>>, authUsers: Array<Record<string, unknown>>, adminIds: string[] = [], errors: { users?: unknown; capabilities?: unknown; auth?: unknown } = {}) {
  return {
    auth: { admin: { listUsers: jest.fn().mockResolvedValue({ data: { users: authUsers }, error: errors.auth ?? null }) } },
    from(table: string) {
      const result = table === "users"
        ? { data: users, error: errors.users ?? null }
        : { data: adminIds.map((user_id) => ({ user_id })), error: errors.capabilities ?? null };
      const builder = { select: () => builder, eq: () => builder, order: () => builder, range: () => Promise.resolve(result), in: () => Promise.resolve(result) };
      return builder;
    },
  } as never;
}

describe("canonical operational employee directory", () => {
  test("resolves Auth login email to Vaibhav's active public UUID when public email differs", async () => {
    const vaibhav = { user_id: "f2750ad8-f480-4d1d-b8a0-e00190534855", name: "Vaibhav Patel", email: "zerodata_vaibhav", is_active: true };
    const result = await listEligibleOperationalEmployees(service([vaibhav], [{ id: vaibhav.user_id, email: "zerodata_vaibhav@zerodata.local" }]));
    expect(result).toEqual({ employees: [{ user_id: vaibhav.user_id, name: "Vaibhav Patel", email: "zerodata_vaibhav@zerodata.local" }], error: null });
  });

  test("excludes inactive profiles", async () => {
    expect(await listEligibleOperationalEmployees(service([{ user_id: "inactive", name: "Inactive", email: "inactive-alias", is_active: false }], [{ id: "inactive", email: "inactive@zerodata.local" }]))).toEqual({ employees: [], error: null });
  });

  test("excludes Admin profiles", async () => {
    expect(await listEligibleOperationalEmployees(service([{ user_id: "admin", name: "Admin", email: "admin-alias", is_active: true }], [{ id: "admin", email: "admin@zerodata.local" }], ["admin"]))).toEqual({ employees: [], error: null });
  });

  test("rejects an unknown Auth login identity", async () => {
    const profile = { user_id: "employee", name: "Employee", email: "profile-alias", is_active: true };
    expect(await listEligibleOperationalEmployees(service([profile], []))).toEqual({ employees: [], error: null });
  });

  test("rejects ambiguous Auth login identities", async () => {
    const profile = { user_id: "employee", name: "Employee", email: "profile-alias", is_active: true };
    expect(await listEligibleOperationalEmployees(service([profile, { ...profile, user_id: "other" }], [{ id: "employee", email: "duplicate@zerodata.local" }, { id: "other", email: "duplicate@zerodata.local" }]))).toEqual({ employees: [], error: null });
  });

  test("fails closed when either authority query fails", async () => {
    expect((await listEligibleOperationalEmployees(service([], [], [], { users: new Error("users") }))).employees).toEqual([]);
    expect((await listEligibleOperationalEmployees(service([], [], [], { capabilities: new Error("caps") }))).employees).toEqual([]);
    expect((await listEligibleOperationalEmployees(service([], [], [], { auth: new Error("auth") }))).employees).toEqual([]);
  });

  test("accepts 500 rows and rejects an over-limit response", async () => {
    const rows = Array.from({ length: 501 }, (_, index) => ({ user_id: `user-${index}`, name: `User ${index}`, email: `u${index}@example.test`, is_active: true }));
    const authUsers = rows.slice(0, 500).map((row) => ({ id: row.user_id, email: `${row.user_id}@zerodata.local` }));
    expect((await listEligibleOperationalEmployees(service(rows.slice(0, 500), authUsers))).employees).toHaveLength(500);
    const overflow = await listEligibleOperationalEmployees(service(rows, authUsers));
    expect(overflow.employees).toEqual([]); expect(overflow.error).toBeInstanceOf(Error);
  });

  test("Distributor import preview assigns Vaibhav from the Auth login email", async () => {
    const id = "f2750ad8-f480-4d1d-b8a0-e00190534855";
    const preview = await buildDistributorImportPreview(service([{ user_id: id, name: "Vaibhav Patel", email: "zerodata_vaibhav", is_active: true }], [{ id, email: "zerodata_vaibhav@zerodata.local" }]), "30000000-0000-4000-a000-000000000001", [{ rowNumber: 2, distributorName: "Alpha", assignedEmployeeEmail: "zerodata_vaibhav@zerodata.local", installationStatus: "pending", installationDate: "", trainingStatus: "pending", trainingDate: "", mappingStatus: "pending", mappedDate: "", activityStatus: "not_applicable", billingStatus: "not_billed", billDate: "", billReference: "", renewalDate: "", distributorReference: "ALPHA" }]);
    expect(preview.rows[0]).toMatchObject({ classification: "NEW", assigned_employee_name: "Vaibhav Patel", payload: { assigned_to: id } });
  });

  test("Receivables import preview assigns Vaibhav from the Auth login email", async () => {
    const id = "f2750ad8-f480-4d1d-b8a0-e00190534855";
    const preview = await buildImportPreview(service([{ user_id: id, name: "Vaibhav Patel", email: "zerodata_vaibhav", is_active: true }], [{ id, email: "zerodata_vaibhav@zerodata.local" }]), "30000000-0000-4000-a000-000000000001", [{ rowNumber: 2, billReference: "INV-1", distributorName: "Alpha", distributorCode: "ALPHA", contactPerson: "Contact", contactPhone: "", billAmount: "100.00", billDueDate: "2026-08-20", nextFollowUpDate: "2026-08-20", assignedEmployeeEmail: "zerodata_vaibhav@zerodata.local", notes: "" }]);
    expect(preview.rows[0]).toMatchObject({ classification: "NEW", assigned_to: id, assigned_employee_name: "Vaibhav Patel" });
  });
});
