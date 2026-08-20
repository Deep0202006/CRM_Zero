jest.mock("server-only", () => ({}), { virtual: true });

import type { EligibleEmployee } from "@/lib/employees/server";
import {
  masterDistributorMutationRows,
  planMasterDistributorRows,
  resolveMasterDistributorRows,
  type MasterDistributorAuthority,
} from "@/lib/distributorMaster/distributors";
import type { MasterDistributorRow } from "@/lib/distributorMaster";

const operationId = "30000000-0000-4000-a000-000000000001";
const employee: EligibleEmployee = {
  user_id: "20000000-0000-4000-a000-000000000001",
  name: "Employee",
  email: "employee@example.com",
};
const row: MasterDistributorRow = {
  rowNumber: 2,
  distributorReference: "ALPHA-1",
  erpName: "MARG",
  distributorName: "Alpha",
  assignedEmployeeEmail: "employee@example.com",
  installationStatus: "done",
  installationDate: "2026-08-13",
  trainingStatus: "done",
  trainingDate: "2026-08-14",
  mappingStatus: "done",
  mappedDate: "2026-08-15",
  activityStatus: "active",
  billingStatus: "billed",
  billDate: "2026-08-16",
  operationalBillReference: "OPS-1",
  renewalDate: "2027-08-13",
  phone: "",
  city: "",
  notes: "",
};

function authority(
  overrides: Partial<MasterDistributorAuthority> = {},
): MasterDistributorAuthority {
  return {
    distributor_id: "40000000-0000-4000-a000-000000000001",
    identity_key: "code:alpha-1",
    erp_id: "e22cbcaa-be77-09f4-1594-e44687e1e46b",
    erp_name: "MARG",
    distributor_name: "Alpha",
    distributor_reference: "alpha-1",
    lead_id: "50000000-0000-4000-a000-000000000001",
    phone: "+91 90000 00000",
    city: "Delhi",
    assigned_to: employee.user_id,
    installation_status: "done",
    installation_completed_at: "2026-08-13",
    training_status: "done",
    training_completed_at: "2026-08-14",
    mapping_status: "done",
    mapped_at: "2026-08-15",
    activity_status: "active",
    billing_status: "billed",
    billed_at: "2026-08-16",
    bill_reference: "OPS-1",
    renewal_date: "2027-08-13",
    version: 7,
    ...overrides,
  };
}

function service(existing: MasterDistributorAuthority[] = []) {
  const inCalls: string[][] = [];
  const users = [
    {
      user_id: employee.user_id,
      name: employee.name,
      email: "profile-alias",
      is_active: true,
    },
  ];
  const instance = {
    inCalls,
    auth: {
      admin: {
        listUsers: jest.fn().mockResolvedValue({
          data: { users: [{ id: employee.user_id, email: employee.email }] },
          error: null,
        }),
      },
    },
    from(table: string) {
      const result =
        table === "users"
          ? { data: users, error: null }
          : table === "user_capabilities"
            ? { data: [], error: null }
            : { data: existing, error: null };
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        range: () => Promise.resolve(result),
        in: (_column: string, values: string[]) => {
          inCalls.push(values);
          return builder;
        },
        then: (resolve: (value: typeof result) => unknown) =>
          Promise.resolve(result).then(resolve),
      };
      return builder;
    },
  };
  return instance;
}

describe("master Distributor Status resolution", () => {
  test("derives a stable new canonical UUID from operation and stable reference", () => {
    const first = planMasterDistributorRows(
      operationId,
      [row],
      [employee],
      [],
    )[0];
    const moved = planMasterDistributorRows(
      operationId,
      [{ ...row, rowNumber: 99 }],
      [employee],
      [],
    )[0];
    expect(first).toMatchObject({
      classification: "NEW",
      payload: {
        identity_key: "code:alpha-1",
        assigned_to: employee.user_id,
        renewal_date: "2027-08-13",
      },
    });
    expect(first.payload?.distributor_id).toBe(moved.payload?.distributor_id);
    expect(first.payload?.distributor_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("resolves case-insensitive stable identity and binds updates to canonical UUID and version", () => {
    const planned = planMasterDistributorRows(
      operationId,
      [{ ...row, renewalDate: "2028-08-13" }],
      [employee],
      [authority()],
    )[0];
    expect(planned).toMatchObject({
      classification: "UPDATE",
      before: { version: 7 },
      payload: {
        distributor_id: authority().distributor_id,
        expected_version: 7,
        renewal_date: "2028-08-13",
      },
    });
    expect(planned.payload).toMatchObject({
      lead_id: authority().lead_id,
      phone: "+91 90000 00000",
      city: "Delhi",
    });
  });

  test("treats existing blanks as NO_CHANGE and preserves canonical operational fields", () => {
    const patchRow: MasterDistributorRow = {
      ...row,
      distributorName: "",
      assignedEmployeeEmail: "",
      installationStatus: "",
      installationDate: "",
      trainingStatus: "",
      trainingDate: "",
      mappingStatus: "",
      mappedDate: "",
      activityStatus: "",
      billingStatus: "",
      billDate: "",
      operationalBillReference: "",
      renewalDate: "",
    };
    const planned = planMasterDistributorRows(
      operationId,
      [patchRow],
      [employee],
      [authority()],
    )[0];
    expect(planned.classification).toBe("EXACT_DUPLICATE");
    expect(planned.payload).toMatchObject({
      distributor_name: "Alpha",
      distributor_reference: "alpha-1",
      assigned_to: employee.user_id,
      phone: "+91 90000 00000",
      city: "Delhi",
      installation_status: "done",
      renewal_date: "2027-08-13",
      bill_reference: "OPS-1",
    });
  });

  test("allows CLEAR only for nullable fields and validates the resulting lifecycle state", () => {
    const cleared = planMasterDistributorRows(
      operationId,
      [
        {
          ...row,
          operationalBillReference: "[CLEAR]",
          renewalDate: "[CLEAR]",
          phone: "[CLEAR]",
          city: "[CLEAR]",
        },
      ],
      [employee],
      [authority()],
    )[0];
    expect(cleared).toMatchObject({
      classification: "UPDATE",
      payload: { bill_reference: "", renewal_date: null, phone: "", city: "" },
    });
    const invalidClear = planMasterDistributorRows(
      operationId,
      [{ ...row, installationDate: "[CLEAR]" }],
      [employee],
      [authority()],
    )[0];
    expect(invalidClear).toMatchObject({
      classification: "IDENTITY_CONFLICT",
      payload: null,
    });
    expect(invalidClear.reason).toMatch(/Installation Date/i);
  });

  test("applies explicit Phone, City, and Notes without treating blank patches as erasure", () => {
    const updated = planMasterDistributorRows(
      operationId,
      [
        {
          ...row,
          phone: "+91 98888 77777",
          city: "Mumbai",
          notes: "Owner-approved correction",
        },
      ],
      [employee],
      [authority()],
    )[0];
    expect(updated).toMatchObject({
      classification: "UPDATE",
      payload: {
        phone: "+91 98888 77777",
        city: "Mumbai",
        note: "Owner-approved correction",
      },
    });
    const unchanged = planMasterDistributorRows(
      operationId,
      [{ ...row, phone: "", city: "", notes: "" }],
      [employee],
      [authority()],
    )[0];
    expect(unchanged.payload).toMatchObject({
      phone: authority().phone,
      city: authority().city,
      note: "",
    });
  });

  test("requires complete state for new rows and never resolves by a matching fuzzy name", () => {
    const incomplete = planMasterDistributorRows(
      operationId,
      [{ ...row, distributorName: "", activityStatus: "" }],
      [employee],
      [],
    )[0];
    expect(incomplete).toMatchObject({
      classification: "IDENTITY_CONFLICT",
      payload: null,
    });
    const differentReference = authority({
      identity_key: "code:beta-1",
      distributor_reference: "BETA-1",
      distributor_name: row.distributorName,
    });
    const planned = planMasterDistributorRows(
      operationId,
      [row],
      [employee],
      [differentReference],
    )[0];
    expect(planned.classification).toBe("NEW");
    expect(planned.payload?.distributor_id).not.toBe(
      differentReference.distributor_id,
    );
  });

  test("classifies unchanged authority without mutating reference casing", () => {
    const planned = planMasterDistributorRows(
      operationId,
      [row],
      [employee],
      [authority()],
    )[0];
    expect(planned.classification).toBe("EXACT_DUPLICATE");
    expect(masterDistributorMutationRows([planned])).toEqual([
      {
        rowNumber: 2,
        classification: "EXACT_DUPLICATE",
        payload: planned.payload,
      },
    ]);
  });

  test("fails closed for invalid employees, repeated references, and contradictory authority", () => {
    expect(
      planMasterDistributorRows(operationId, [row], [], [])[0],
    ).toMatchObject({ classification: "INVALID_EMPLOYEE", payload: null });
    const repeated = planMasterDistributorRows(
      operationId,
      [row, { ...row, rowNumber: 3, distributorName: "Renamed" }],
      [employee],
      [],
    );
    expect(repeated[1]).toMatchObject({
      classification: "IDENTITY_CONFLICT",
      payload: null,
    });
    const contradictory = authority({ distributor_reference: "BETA-1" });
    expect(
      planMasterDistributorRows(
        operationId,
        [row],
        [employee],
        [contradictory],
      )[0],
    ).toMatchObject({ classification: "IDENTITY_CONFLICT", payload: null });
  });

  test("uses the certified employee resolver and bounded 100-key distributor reads", async () => {
    const mock = service();
    const rows = Array.from({ length: 101 }, (_, index) => ({
      ...row,
      rowNumber: index + 2,
      distributorReference: `DIST-${index}`,
      distributorName: `Distributor ${index}`,
    }));
    const planned = await resolveMasterDistributorRows(
      mock as never,
      operationId,
      rows,
    );
    expect(planned).toHaveLength(101);
    expect(
      mock.inCalls.map((values) => values.length).filter((size) => size !== 2),
    ).toEqual([100, 1, 1]);
    expect(
      planned.every(
        (item) =>
          item.classification === "NEW" &&
          item.payload?.assigned_to === employee.user_id,
      ),
    ).toBe(true);
  });
});
