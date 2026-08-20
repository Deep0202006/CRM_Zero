jest.mock("server-only", () => ({}), { virtual: true });

import fs from "fs";
import path from "path";
import type { MasterPaymentRow } from "@/lib/distributorMaster";
import {
  masterPaymentMutationRows,
  planMasterPaymentRows,
  type MasterImportedPaymentAuthority,
  type MasterPaymentTarget,
} from "@/lib/distributorMaster/payments";

const receivableId = "50000000-0000-4000-a000-000000000001";
const row: MasterPaymentRow = {
  rowNumber: 2, distributorReference: "ALPHA-1", billReference: "INV-1", paymentImportKey: "LEGACY-001",
  paymentAmount: "40.00", paymentDate: "2026-08-19", paymentMode: "Bank Transfer", paymentReference: "UTR-1", notes: "Historical receipt",
};
const target: MasterPaymentTarget = {
  receivableId, distributorReference: "ALPHA-1", billReference: "INV-1", billAmount: "100.00", confirmedPaidAmount: "0.00",
  nextFollowUpDate: "2026-08-21", lifecycleStatus: "active", importedPayments: [],
};

function imported(overrides: Partial<MasterImportedPaymentAuthority> = {}): MasterImportedPaymentAuthority {
  return { payment_id: "60000000-0000-4000-a000-000000000001", import_key: "legacy-001", amount: "40.00", payment_date: "2026-08-19", payment_mode: "Bank Transfer", payment_reference: "UTR-1", note: "Historical receipt", verification_status: "confirmed", ...overrides };
}

describe("master historical confirmed payments", () => {
  test("targets one exact Receivable UUID and derives Partially Paid from confirmed authority", () => {
    const planned = planMasterPaymentRows([row], [target], "2026-08-20")[0];
    expect(planned).toMatchObject({ classification: "NEW", resolvedReceivableId: receivableId, before: { confirmedPaidAmount: "0.00", outstandingAmount: "100.00", paymentState: "Unpaid" }, after: { confirmedPaidAmount: "40.00", outstandingAmount: "60.00", paymentState: "Partially Paid" }, payload: { receivable_id: receivableId, import_key: "LEGACY-001" } });
    expect(masterPaymentMutationRows([planned])).toHaveLength(1);
  });

  test("applies different source keys cumulatively and reaches Paid only at exact confirmed total", () => {
    const second = { ...row, rowNumber: 3, paymentImportKey: "LEGACY-002", paymentAmount: "60.00", paymentReference: "UTR-2" };
    const planned = planMasterPaymentRows([row, second], [target], "2026-08-20");
    expect(planned[0].after?.paymentState).toBe("Partially Paid");
    expect(planned[1]).toMatchObject({ classification: "NEW", before: { confirmedPaidAmount: "40.00" }, after: { confirmedPaidAmount: "100.00", outstandingAmount: "0.00", paymentState: "Paid" } });
    expect(masterPaymentMutationRows(planned)).toHaveLength(2);
  });

  test("uses per-receivable import key as idempotency identity and skips exact confirmed replay", () => {
    const planned = planMasterPaymentRows([row], [{ ...target, confirmedPaidAmount: "40.00", importedPayments: [imported()] }], "2026-08-20")[0];
    expect(planned).toMatchObject({ classification: "EXACT_DUPLICATE", existingPayment: { payment_id: imported().payment_id }, before: { confirmedPaidAmount: "40.00" }, after: { confirmedPaidAmount: "40.00" } });
    expect(masterPaymentMutationRows([planned])).toEqual([expect.objectContaining({ row_number: 2, payment_id: imported().payment_id, import_key: "LEGACY-001" })]);
  });

  test("blocks reused import keys with changed or ineffective payment events", () => {
    for (const existing of [imported({ amount: "41.00" }), imported({ verification_status: "reversed" }), imported({ payment_reference: "OTHER" }), imported({ payment_date: "2026-08-18" }), imported({ payment_mode: "Cash" }), imported({ note: "Changed" })]) {
      const planned = planMasterPaymentRows([row], [{ ...target, importedPayments: [existing] }], "2026-08-20")[0];
      expect(planned).toMatchObject({ classification: "CONFLICTING_DUPLICATE", payload: null });
      expect(() => masterPaymentMutationRows([planned])).toThrow(/blocking/i);
    }
  });

  test("scopes the normalized import key to one exact Receivable", () => {
    const otherTarget = { ...target, receivableId: "50000000-0000-4000-a000-000000000002", billReference: "INV-2" };
    const otherRow = { ...row, rowNumber: 3, billReference: "INV-2", paymentImportKey: " legacy-001 " };
    const planned = planMasterPaymentRows([row, otherRow], [target, otherTarget], "2026-08-20");
    expect(planned.map((payment) => payment.classification)).toEqual(["NEW", "NEW"]);
    expect(new Set(planned.map((payment) => payment.payload?.payment_id)).size).toBe(2);
  });

  test("evaluates follow-up after the complete payment set", () => {
    const second = { ...row, rowNumber: 3, paymentImportKey: "LEGACY-002", paymentAmount: "60.00", paymentReference: "UTR-2" };
    const fullyPaid = planMasterPaymentRows([row, second], [{ ...target, nextFollowUpDate: null }], "2026-08-20");
    expect(fullyPaid.map((payment) => payment.classification)).toEqual(["NEW", "NEW"]);
    const partial = planMasterPaymentRows([row], [{ ...target, nextFollowUpDate: null }], "2026-08-20");
    expect(partial[0].classification).toBe("NEXT_FOLLOW_UP_REQUIRED");
  });

  test("blocks aggregate allocation, cancellation, future dates, overpayment, and unsafe partial follow-up", () => {
    expect(planMasterPaymentRows([row], [], "2026-08-20")[0].classification).toBe("INVALID_RECEIVABLE");
    expect(planMasterPaymentRows([row], [{ ...target, lifecycleStatus: "cancelled" }], "2026-08-20")[0].classification).toBe("INVALID_RECEIVABLE_STATE");
    expect(planMasterPaymentRows([{ ...row, paymentDate: "2026-08-21" }], [target], "2026-08-20")[0].classification).toBe("FUTURE_PAYMENT_DATE");
    expect(planMasterPaymentRows([{ ...row, paymentAmount: "101.00" }], [target], "2026-08-20")[0].classification).toBe("OVERPAYMENT");
    expect(planMasterPaymentRows([row], [{ ...target, nextFollowUpDate: "2026-08-19" }], "2026-08-20")[0].classification).toBe("NEXT_FOLLOW_UP_REQUIRED");
  });

  test("stable payment UUID is independent of workbook row and operation identity", () => {
    const first = planMasterPaymentRows([row], [target], "2026-08-20")[0].payload?.payment_id;
    const moved = planMasterPaymentRows([{ ...row, rowNumber: 99 }], [target], "2026-08-20")[0].payload?.payment_id;
    expect(first).toBe(moved);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("Migration 046 adds bounded service-only idempotent confirmed-payment authority", () => {
    const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/046_unified_distributor_master_import.sql"), "utf8");
    expect(sql).toContain("add column import_key text");
    expect(sql).not.toMatch(/add column import_key text\s+not null/i);
    expect(sql).toContain("receivable_payments_import_key_uidx");
    expect(sql).toContain("on public.receivable_payments(receivable_id,lower(regexp_replace");
    expect(sql).toContain("where import_key is not null");
    expect(sql).toContain("resolve_distributor_master_payment_targets_v1");
    expect(sql).toContain("sum(rp.amount) filter(where rp.verification_status='confirmed')");
    expect(sql).toContain("apply_distributor_master_payments_v1");
    expect(sql).toContain("from public.receivables where receivable_id=v_receivable_id for update");
    expect(sql).toContain("'confirmed',p_actor_id,now(),import_key");
    expect(sql).toContain("'payment_confirmed',payment_id");
    expect(sql).toContain("MASTER_PAYMENT_OVERPAYMENT");
    expect(sql).toContain("MASTER_PAYMENT_CONCURRENT_CONFLICT");
    expect(sql).toContain("exception when unique_violation");
    expect(sql).toContain("grant execute on function public.apply_distributor_master_payments_v1(uuid,jsonb) to service_role");
    expect(sql).not.toMatch(/update public\.receivables[\s\S]*payment_state=/i);
  });
});
