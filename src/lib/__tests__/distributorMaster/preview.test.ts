jest.mock("server-only", () => ({}), { virtual: true });

import type { ParsedMasterWorkbook } from "@/lib/distributorMaster";
import type { MasterDistributorAuthority } from "@/lib/distributorMaster/distributors";
import {
  MASTER_PREVIEW_CLASSIFICATIONS,
  MasterPlanRevalidationError,
  buildMasterImportPreview,
  resolvedMasterPlanHash,
  revalidateMasterImportConfirmation,
} from "@/lib/distributorMaster/preview";
import { type MasterReceivableAuthority } from "@/lib/distributorMaster/receivables";

const employee = {
  user_id: "20000000-0000-4000-a000-000000000001",
  name: "Employee",
  email: "employee@example.com",
  is_active: true,
};
const operationId = "30000000-0000-4000-a000-000000000001";
const workbook: ParsedMasterWorkbook = {
  format: "CRM_DISTRIBUTOR_MASTER_V2",
  totalRows: 3,
  distributors: [
    {
      rowNumber: 2,
      distributorReference: "ALPHA-1",
      erpName: "MARG",
      distributorName: "Alpha",
      assignedEmployeeEmail: employee.email,
      installationStatus: "done",
      installationDate: "2026-08-10",
      trainingStatus: "done",
      trainingDate: "2026-08-11",
      mappingStatus: "done",
      mappedDate: "2026-08-12",
      activityStatus: "active",
      billingStatus: "billed",
      billDate: "2026-08-13",
      operationalBillReference: "OPS-1",
      renewalDate: "2027-08-13",
    },
  ],
  receivables: [
    {
      rowNumber: 2,
      distributorReference: "ALPHA-1",
      billReference: "INV-1",
      contactPerson: "Customer",
      contactPhone: "999",
      billAmount: "100.00",
      billDueDate: "2026-08-15",
      nextFollowUpDate: "2026-08-21",
      notes: "Bill",
    },
  ],
  payments: [
    {
      rowNumber: 2,
      distributorReference: "ALPHA-1",
      billReference: "INV-1",
      paymentImportKey: "PAY-1",
      paymentAmount: "40.00",
      paymentDate: "2026-08-19",
      paymentMode: "Bank",
      paymentReference: "UTR-1",
      notes: "Receipt",
    },
  ],
};

function canonicalDistributor(): MasterDistributorAuthority {
  return {
    distributor_id: "40000000-0000-4000-a000-000000000001",
    identity_key: "code:alpha-1",
    erp_id: "e22cbcaa-be77-09f4-1594-e44687e1e46b",
    erp_name: "MARG",
    distributor_name: "Alpha",
    distributor_reference: "ALPHA-1",
    lead_id: null,
    phone: "+91 90000 00000",
    city: "Delhi",
    assigned_to: employee.user_id,
    installation_status: "done",
    installation_completed_at: "2026-08-10",
    training_status: "done",
    training_completed_at: "2026-08-11",
    mapping_status: "done",
    mapped_at: "2026-08-12",
    activity_status: "active",
    billing_status: "billed",
    billed_at: "2026-08-13",
    bill_reference: "OPS-1",
    renewal_date: "2027-08-13",
    version: 4,
  };
}

function canonicalReceivable(
  distributorId: string,
  amount = "100.00",
): MasterReceivableAuthority {
  return {
    receivable_id: "50000000-0000-4000-a000-000000000001",
    distributor_id: distributorId,
    bill_reference: "INV-1",
    bill_reference_key: "inv-1",
    contact_person: "Customer",
    contact_phone: "999",
    bill_amount: amount,
    bill_due_date: "2026-08-15",
    next_follow_up_date: "2026-08-21",
    assigned_to: employee.user_id,
    lifecycle_status: "active",
    version: 2,
    confirmed_paid_amount: "0.00",
  };
}

function service(state: {
  distributors: MasterDistributorAuthority[];
  receivables: MasterReceivableAuthority[];
}) {
  const forbiddenWrite = jest.fn(() => {
    throw new Error("Preview attempted a write.");
  });
  const rpc = jest
    .fn()
    .mockImplementation(
      (name: string, args: { p_rows: Array<Record<string, unknown>> }) => {
        if (name === "resolve_distributor_master_receivables_v1")
          return Promise.resolve({ data: state.receivables, error: null });
        if (name === "resolve_distributor_master_payment_targets_v1") {
          const data = args.p_rows.flatMap((input) =>
            state.receivables
              .filter(
                (receivable) =>
                  receivable.distributor_id === input.distributor_id &&
                  receivable.bill_reference_key === input.bill_reference_key,
              )
              .map((receivable) => ({
                row_number: input.row_number,
                receivable_id: receivable.receivable_id,
                distributor_id: receivable.distributor_id,
                bill_reference: receivable.bill_reference,
                bill_amount: receivable.bill_amount,
                next_follow_up_date: receivable.next_follow_up_date,
                lifecycle_status: receivable.lifecycle_status,
                confirmed_paid_amount: "0.00",
                payment_id: null,
                import_key: null,
                payment_amount: null,
                payment_date: null,
                payment_mode: null,
                payment_reference: null,
                payment_note: null,
                verification_status: null,
              })),
          );
          return Promise.resolve({ data, error: null });
        }
        return Promise.resolve({
          data: null,
          error: { code: "UNEXPECTED_RPC" },
        });
      },
    );
  const from = jest.fn().mockImplementation((table: string) => {
    const result =
      table === "users"
        ? { data: [employee], error: null }
        : table === "user_capabilities" || table === "erp_systems"
          ? { data: [], error: null }
          : { data: state.distributors, error: null };
    const builder = {
      select: () => builder,
      eq: () => builder,
      order: () => builder,
      range: () => Promise.resolve(result),
      in: () => builder,
      then: (resolve: (value: typeof result) => unknown) =>
        Promise.resolve(result).then(resolve),
      insert: forbiddenWrite,
      update: forbiddenWrite,
      upsert: forbiddenWrite,
      delete: forbiddenWrite,
    };
    return builder;
  });
  return {
    auth: {
      admin: {
        listUsers: jest.fn().mockResolvedValue({
          data: { users: [{ id: employee.user_id, email: employee.email }] },
          error: null,
        }),
      },
    },
    from,
    rpc,
    forbiddenWrite,
  };
}

describe("complete master import preview", () => {
  test("resolves and classifies every cross-sheet row write-free with Before to After state", async () => {
    const mock = service({ distributors: [], receivables: [] });
    const preview = await buildMasterImportPreview(
      mock as never,
      workbook,
      operationId,
      "2026-08-20",
    );
    expect(preview).toMatchObject({
      blocking: false,
      counts: {
        total: 3,
        blocking: 0,
        distributors: { NEW_DISTRIBUTOR: 1 },
        receivables: { CREATE_PARTIAL_RECEIVABLE: 1 },
        payments: { CREATE_CONFIRMED_PAYMENT: 1 },
      },
    });
    expect(preview.rows.distributors[0]).toMatchObject({
      classification: "NEW_DISTRIBUTOR",
      action: "CREATE",
      before: null,
      after: { distributor_id: expect.any(String) },
    });
    expect(preview.rows.receivables[0]).toMatchObject({
      classification: "CREATE_PARTIAL_RECEIVABLE",
      action: "CREATE",
      before: null,
      after: {
        distributor_id: preview.rows.distributors[0].payload?.distributor_id,
      },
    });
    expect(preview.rows.payments[0]).toMatchObject({
      classification: "CREATE_CONFIRMED_PAYMENT",
      action: "CONFIRM",
      before: { paymentState: "Unpaid", outstandingAmount: "100.00" },
      after: { paymentState: "Partially Paid", outstandingAmount: "60.00" },
    });
    expect(preview.resolvedPlanHash).toMatch(/^[0-9a-f]{64}$/);
    expect(mock.rpc.mock.calls.map(([name]) => name)).toEqual([
      "resolve_distributor_master_receivables_v1",
      "resolve_distributor_master_payment_targets_v1",
    ]);
    expect(mock.from.mock.calls.map(([table]) => table).sort()).toEqual([
      "distributor_accounts",
      "erp_systems",
      "users",
      "user_capabilities",
    ].sort());
    expect(mock.forbiddenWrite).not.toHaveBeenCalled();
  });

  test("publishes only the exact bounded classification vocabularies", () => {
    expect(MASTER_PREVIEW_CLASSIFICATIONS).toEqual({
      distributors: [
        "NEW_DISTRIBUTOR",
        "UPDATE_DISTRIBUTOR",
        "EXACT_DUPLICATE",
        "INVALID_EMPLOYEE",
        "AMBIGUOUS_DISTRIBUTOR",
        "INVALID_DISTRIBUTOR_STATE",
      ],
      receivables: [
        "CREATE_UNPAID_RECEIVABLE",
        "CREATE_PARTIAL_RECEIVABLE",
        "CREATE_PAID_RECEIVABLE",
        "EXACT_DUPLICATE",
        "CONFLICTING_RECEIVABLE",
        "INVALID_DISTRIBUTOR",
        "INVALID_DISTRIBUTOR_STATUS",
      ],
      payments: [
        "CREATE_CONFIRMED_PAYMENT",
        "EXACT_DUPLICATE",
        "CONFLICTING_PAYMENT",
        "PAYMENT_NOT_ELIGIBLE",
        "OVERPAYMENT",
        "FUTURE_PAYMENT_DATE",
        "RECEIVABLE_NOT_FOUND",
      ],
    });
  });

  test("hashing is canonical across object key insertion order and binds the business date", () => {
    expect(resolvedMasterPlanHash({ b: 2, a: { d: 4, c: 3 } })).toBe(
      resolvedMasterPlanHash({ a: { c: 3, d: 4 }, b: 2 }),
    );
    expect(resolvedMasterPlanHash({ businessDate: "2026-08-20" })).not.toBe(
      resolvedMasterPlanHash({ businessDate: "2026-08-21" }),
    );
    expect(
      resolvedMasterPlanHash({ action: "CREATE", resolvedId: "a" }),
    ).not.toBe(resolvedMasterPlanHash({ action: "SKIP", resolvedId: "a" }));
    expect(
      resolvedMasterPlanHash({ action: "CREATE", resolvedId: "a" }),
    ).not.toBe(resolvedMasterPlanHash({ action: "CREATE", resolvedId: "b" }));
  });

  test("evaluates Receivable follow-up against the complete same-workbook payment result", async () => {
    const fullyPaidWorkbook: ParsedMasterWorkbook = {
      ...workbook,
      receivables: [{ ...workbook.receivables[0], nextFollowUpDate: "" }],
      payments: [{ ...workbook.payments[0], paymentAmount: "100.00" }],
    };
    const fullyPaid = await buildMasterImportPreview(
      service({ distributors: [], receivables: [] }) as never,
      fullyPaidWorkbook,
      operationId,
      "2026-08-20",
    );
    expect(fullyPaid).toMatchObject({
      blocking: false,
      rows: {
        receivables: [{ classification: "CREATE_PAID_RECEIVABLE" }],
        payments: [
          { after: { paymentState: "Paid", outstandingAmount: "0.00" } },
        ],
      },
    });

    const partial = await buildMasterImportPreview(
      service({ distributors: [], receivables: [] }) as never,
      { ...fullyPaidWorkbook, payments: workbook.payments },
      operationId,
      "2026-08-20",
    );
    expect(partial.rows.receivables[0]).toMatchObject({
      classification: "INVALID_DISTRIBUTOR_STATUS",
      payload: null,
    });
    expect(partial.blocking).toBe(true);
  });

  test("confirmation rebuilds current authority and accepts only the identical resolved hash", async () => {
    const state = {
      distributors: [] as MasterDistributorAuthority[],
      receivables: [] as MasterReceivableAuthority[],
    };
    const mock = service(state);
    const preview = await buildMasterImportPreview(
      mock as never,
      workbook,
      operationId,
      "2026-08-20",
    );
    await expect(
      revalidateMasterImportConfirmation(
        mock as never,
        workbook,
        operationId,
        preview.resolvedPlanHash,
        "2026-08-20",
      ),
    ).resolves.toMatchObject({ resolvedPlanHash: preview.resolvedPlanHash });
    state.distributors.push(canonicalDistributor());
    await expect(
      revalidateMasterImportConfirmation(
        mock as never,
        workbook,
        operationId,
        preview.resolvedPlanHash,
        "2026-08-20",
      ),
    ).rejects.toMatchObject({
      code: "IMPORT_REFRESH_REQUIRED",
      preview: {
        rows: {
          distributors: [{ classification: "EXACT_DUPLICATE", action: "SKIP" }],
        },
      },
    });
  });

  test("a current conflicting bill blocks both its Receivable row and dependent Payment row", async () => {
    const distributor = canonicalDistributor();
    const mock = service({
      distributors: [distributor],
      receivables: [canonicalReceivable(distributor.distributor_id, "101.00")],
    });
    const preview = await buildMasterImportPreview(
      mock as never,
      workbook,
      operationId,
      "2026-08-20",
    );
    expect(preview).toMatchObject({ blocking: true, counts: { blocking: 2 } });
    expect(preview.rows.receivables[0]).toMatchObject({
      classification: "CONFLICTING_RECEIVABLE",
      before: { bill_amount: "101.00" },
      after: { bill_amount: "100.00" },
    });
    expect(preview.rows.payments[0]).toMatchObject({
      classification: "RECEIVABLE_NOT_FOUND",
      payload: null,
    });
    await expect(
      revalidateMasterImportConfirmation(
        mock as never,
        workbook,
        operationId,
        preview.resolvedPlanHash,
        "2026-08-20",
      ),
    ).rejects.toBeInstanceOf(MasterPlanRevalidationError);
  });

  test("authority changes alter the complete resolved plan hash even when row count is unchanged", async () => {
    const initial = await buildMasterImportPreview(
      service({ distributors: [], receivables: [] }) as never,
      workbook,
      operationId,
      "2026-08-20",
    );
    const distributor = canonicalDistributor();
    const changed = await buildMasterImportPreview(
      service({
        distributors: [distributor],
        receivables: [canonicalReceivable(distributor.distributor_id)],
      }) as never,
      workbook,
      operationId,
      "2026-08-20",
    );
    expect(changed.counts.total).toBe(initial.counts.total);
    expect(changed.resolvedPlanHash).not.toBe(initial.resolvedPlanHash);
    expect(changed.rows.receivables[0].before?.receivable_id).toBe(
      "50000000-0000-4000-a000-000000000001",
    );
  });
});
