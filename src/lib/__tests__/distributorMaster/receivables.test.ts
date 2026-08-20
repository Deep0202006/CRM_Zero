jest.mock("server-only", () => ({}), { virtual: true });

import fs from "fs";
import path from "path";
import type { EligibleEmployee } from "@/lib/employees/server";
import type { MasterReceivableRow } from "@/lib/distributorMaster";
import { planMasterDistributorRows } from "@/lib/distributorMaster/distributors";
import {
  distributorsForMasterReceivables,
  finalizeMasterReceivableFollowUps,
  masterReceivableMutationRows,
  planMasterReceivableRows,
  type MasterReceivableAuthority,
  type MasterReceivableDistributor,
} from "@/lib/distributorMaster/receivables";

const operationId = "30000000-0000-4000-a000-000000000001";
const employee: EligibleEmployee = { user_id: "20000000-0000-4000-a000-000000000001", name: "Employee", email: "employee@example.com" };
const distributor: MasterReceivableDistributor = { distributorId: "40000000-0000-4000-a000-000000000001", distributorName: "Alpha", distributorReference: "ALPHA-1", billingStatus: "billed", assignedTo: employee.user_id };
const row: MasterReceivableRow = { rowNumber: 2, distributorReference: "ALPHA-1", billReference: "INV-1", contactPerson: "Customer", contactPhone: "999", billAmount: "100.00", billDueDate: "2026-08-01", nextFollowUpDate: "2026-08-20", notes: "Initial obligation" };

function authority(overrides: Partial<MasterReceivableAuthority> = {}): MasterReceivableAuthority {
  return { receivable_id: "50000000-0000-4000-a000-000000000001", distributor_id: distributor.distributorId, bill_reference: "INV-1", bill_reference_key: "inv-1", contact_person: "Customer", contact_phone: "999", bill_amount: "100.00", bill_due_date: "2026-08-01", next_follow_up_date: "2026-08-20", assigned_to: employee.user_id, lifecycle_status: "active", version: 1, confirmed_paid_amount: "0.00", ...overrides };
}

describe("master Receivables planning", () => {
  test("creates one canonical obligation with row-independent stable UUID", () => {
    const first = planMasterReceivableRows(operationId, [row], [employee], [distributor], [])[0];
    const moved = planMasterReceivableRows(operationId, [{ ...row, rowNumber: 99 }], [employee], [distributor], [])[0];
    expect(first).toMatchObject({ classification: "NEW", payload: { distributor_id: distributor.distributorId, bill_amount: "100.00", assigned_to: employee.user_id } });
    expect(first.resolvedReceivableId).toBe(moved.resolvedReceivableId);
    expect(masterReceivableMutationRows([first])[0]).toMatchObject({ row_number: 2, receivable_id: first.resolvedReceivableId });
  });

  test("uses the stable UUID of a Distributor created earlier in the same workbook plan", () => {
    const distributorRow = {
      rowNumber: 2, distributorReference: "ALPHA-1", distributorName: "Alpha", assignedEmployeeEmail: employee.email,
      installationStatus: "done" as const, installationDate: "2026-08-10", trainingStatus: "done" as const, trainingDate: "2026-08-11",
      mappingStatus: "done" as const, mappedDate: "2026-08-12", activityStatus: "active" as const, billingStatus: "billed" as const,
      billDate: "2026-08-13", operationalBillReference: "OPS-1", renewalDate: "2027-08-13",
    };
    const distributorPlan = planMasterDistributorRows(operationId, [distributorRow], [employee], []);
    const resolved = distributorsForMasterReceivables(distributorPlan, []);
    const receivable = planMasterReceivableRows(operationId, [row], [employee], resolved, [])[0];
    expect(receivable).toMatchObject({ classification: "NEW", payload: { distributor_id: distributorPlan[0].payload?.distributor_id } });
  });

  test("skips an exact canonical bill identity even when display reference casing differs", () => {
    const planned = planMasterReceivableRows(operationId, [{ ...row, billReference: " inv-1 " }], [employee], [distributor], [authority()])[0];
    expect(planned).toMatchObject({ classification: "EXACT_DUPLICATE", resolvedReceivableId: authority().receivable_id, before: { receivable_id: authority().receivable_id } });
    expect(masterReceivableMutationRows([planned])).toEqual([expect.objectContaining({ row_number: 2, receivable_id: authority().receivable_id })]);
  });

  test("blocks an existing bill identity with independently different obligation fields", () => {
    const planned = planMasterReceivableRows(operationId, [row], [employee], [distributor], [authority({ bill_amount: "101.00" })])[0];
    expect(planned).toMatchObject({ classification: "CONFLICTING_DUPLICATE", payload: null, before: { bill_amount: "101.00" }, after: { bill_amount: "100.00" } });
    expect(() => masterReceivableMutationRows([planned])).toThrow(/blocking/i);
  });

  test("fails closed for unresolved or unbilled distributors, invalid employees, and stale follow-up", () => {
    expect(planMasterReceivableRows(operationId, [row], [employee], [], [])[0].classification).toBe("INVALID_DISTRIBUTOR");
    expect(planMasterReceivableRows(operationId, [row], [employee], [{ ...distributor, billingStatus: "not_billed" }], [])[0].classification).toBe("INVALID_DISTRIBUTOR_STATUS");
    expect(planMasterReceivableRows(operationId, [row], [], [distributor], [])[0].classification).toBe("INVALID_EMPLOYEE");
  });

  test("treats independent canonical contact, assignee, dates, and money as duplicate-critical", () => {
    for (const changed of [{ contact_phone: "998" }, { assigned_to: "20000000-0000-4000-a000-000000000002" }, { bill_due_date: "2026-08-02" }, { next_follow_up_date: "2026-08-21" }, { bill_amount: "100.01" }]) {
      expect(planMasterReceivableRows(operationId, [row], [employee], [distributor], [authority(changed)])[0].classification).toBe("CONFLICTING_DUPLICATE");
    }
  });

  test("derives assignment from the post-import Distributor instead of a Receivables column", () => {
    const reassigned = { ...distributor, assignedTo: "20000000-0000-4000-a000-000000000002" };
    const nextEmployee = { ...employee, user_id: reassigned.assignedTo, name: "Next Employee", email: "next@example.com" };
    const planned = planMasterReceivableRows(operationId, [row], [employee, nextEmployee], [reassigned], [])[0];
    expect(planned).toMatchObject({ classification: "NEW", payload: { assigned_to: reassigned.assignedTo }, assignedEmployeeName: nextEmployee.name });
  });

  test("requires follow-up only when the complete planned payment result remains outstanding", () => {
    const noFollowUp = planMasterReceivableRows(operationId, [{ ...row, nextFollowUpDate: "" }], [employee], [distributor], [])[0];
    const paid = finalizeMasterReceivableFollowUps([noFollowUp], [{ resolvedReceivableId: noFollowUp.resolvedReceivableId, classification: "NEW", after: { outstandingAmount: "0.00" } } as never], "2026-08-20")[0];
    expect(paid.classification).toBe("NEW");
    const outstanding = finalizeMasterReceivableFollowUps([noFollowUp], [{ resolvedReceivableId: noFollowUp.resolvedReceivableId, classification: "NEW", after: { outstandingAmount: "0.01" } } as never], "2026-08-20")[0];
    expect(outstanding).toMatchObject({ classification: "INVALID_FOLLOW_UP_DATE", payload: null });
  });

  test("migration resolver is service-only, exact-keyed, bounded, and read-only", () => {
    const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/046_unified_distributor_master_import.sql"), "utf8");
    expect(sql).toContain("resolve_distributor_master_receivables_v1");
    expect(sql).toContain("jsonb_array_length(p_rows) > 5000");
    expect(sql).toContain("r.distributor_id=i.distributor_id and r.bill_reference_key=i.bill_reference_key");
    expect(sql).toContain("coalesce(p.confirmed_paid_amount,0)::text");
    expect(sql).toContain("MASTER_RECEIVABLE_NEXT_FOLLOW_UP_REQUIRED");
    expect(sql).toContain("v_receivable_apply_rows");
    expect(sql).toContain("grant execute on function public.resolve_distributor_master_receivables_v1(jsonb) to service_role");
    const start = sql.indexOf("create or replace function public.resolve_distributor_master_receivables_v1");
    const resolver = sql.slice(start, sql.indexOf("revoke all on function public.resolve_distributor_master_receivables_v1", start));
    expect(resolver).not.toMatch(/insert into|update public|delete from/i);
  });
});
