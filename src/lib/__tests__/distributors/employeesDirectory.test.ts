jest.mock("server-only", () => ({}), { virtual: true });

import { listEligibleOperationalEmployees } from "@/lib/employees/server";

function service(users: Array<Record<string, unknown>>, adminIds: string[] = [], errors: { users?: unknown; capabilities?: unknown } = {}) {
  return {
    from(table: string) {
      const result = table === "users"
        ? { data: users, error: errors.users ?? null }
        : { data: adminIds.map((user_id) => ({ user_id })), error: errors.capabilities ?? null };
      const builder = { select: () => builder, eq: () => builder, order: () => builder, range: () => Promise.resolve(result) };
      return builder;
    },
  } as never;
}

describe("canonical operational employee directory", () => {
  test("returns active non-Admin identities only", async () => {
    const result = await listEligibleOperationalEmployees(service([
      { user_id: "employee", name: "Employee", email: "employee@example.test", is_active: true },
      { user_id: "inactive", name: "Inactive", email: "inactive@example.test", is_active: false },
      { user_id: "admin", name: "Admin", email: "admin@example.test", is_active: true },
    ], ["admin"]));
    expect(result).toEqual({ employees: [{ user_id: "employee", name: "Employee", email: "employee@example.test" }], error: null });
  });

  test("fails closed when either authority query fails", async () => {
    expect((await listEligibleOperationalEmployees(service([], [], { users: new Error("users") }))).employees).toEqual([]);
    expect((await listEligibleOperationalEmployees(service([], [], { capabilities: new Error("caps") }))).employees).toEqual([]);
  });

  test("accepts 500 rows and rejects an over-limit response", async () => {
    const rows = Array.from({ length: 501 }, (_, index) => ({ user_id: `user-${index}`, name: `User ${index}`, email: `u${index}@example.test`, is_active: true }));
    expect((await listEligibleOperationalEmployees(service(rows.slice(0, 500)))).employees).toHaveLength(500);
    const overflow = await listEligibleOperationalEmployees(service(rows));
    expect(overflow.employees).toEqual([]); expect(overflow.error).toBeInstanceOf(Error);
  });
});
