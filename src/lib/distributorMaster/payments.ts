import "server-only";
import { createHash } from "crypto";
import { derivePaymentState, minorUnitsToDecimal, parseMoneyToMinorUnits, type LifecycleStatus, type PaymentState } from "@/lib/receivables/domain";
import type { PlannedMasterReceivableRow } from "./receivables";
import type { MasterPaymentRow } from "./workbook";

const MAX_PAYMENT_ROWS = 5_000;

export const MASTER_PAYMENT_CLASSIFICATIONS = ["NEW", "EXACT_DUPLICATE", "CONFLICTING_DUPLICATE", "INVALID_RECEIVABLE", "INVALID_RECEIVABLE_STATE", "FUTURE_PAYMENT_DATE", "OVERPAYMENT", "NEXT_FOLLOW_UP_REQUIRED"] as const;
export type MasterPaymentClassification = typeof MASTER_PAYMENT_CLASSIFICATIONS[number];

export interface MasterImportedPaymentAuthority {
  payment_id: string;
  import_key: string;
  amount: string;
  payment_date: string;
  payment_mode: string | null;
  payment_reference: string | null;
  note: string | null;
  verification_status: "reported" | "confirmed" | "rejected" | "reversed";
}

export interface MasterPaymentTarget {
  receivableId: string;
  distributorReference: string;
  billReference: string;
  billAmount: string;
  confirmedPaidAmount: string;
  nextFollowUpDate: string | null;
  lifecycleStatus: LifecycleStatus;
  importedPayments: MasterImportedPaymentAuthority[];
  deferFollowUpValidation?: boolean;
}

export interface MasterPaymentResolutionRow {
  row_number: number;
  receivable_id: string;
  distributor_id: string;
  bill_reference: string;
  bill_amount: string;
  next_follow_up_date: string | null;
  lifecycle_status: LifecycleStatus;
  confirmed_paid_amount: string;
  payment_id: string | null;
  import_key: string | null;
  payment_amount: string | null;
  payment_date: string | null;
  payment_mode: string | null;
  payment_reference: string | null;
  payment_note: string | null;
  verification_status: MasterImportedPaymentAuthority["verification_status"] | null;
}

export interface MasterPaymentPayload {
  payment_id: string;
  receivable_id: string;
  import_key: string;
  amount: string;
  payment_date: string;
  payment_mode: string;
  payment_reference: string;
  note: string;
}

export interface MasterPaymentBalance {
  billAmount: string;
  confirmedPaidAmount: string;
  outstandingAmount: string;
  paymentState: PaymentState;
}

export interface PlannedMasterPaymentRow extends MasterPaymentRow {
  classification: MasterPaymentClassification;
  reason?: string;
  resolvedReceivableId?: string;
  before: MasterPaymentBalance | null;
  after: MasterPaymentBalance | null;
  existingPayment: MasterImportedPaymentAuthority | null;
  payload: MasterPaymentPayload | null;
}

function normalized(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-IN").replace(/\s+/g, " ");
}

function targetKey(distributorReference: string, billReference: string): string {
  return `${normalized(distributorReference)}|${normalized(billReference)}`;
}

function stablePaymentId(receivableId: string, importKey: string): string {
  const hex = createHash("sha256").update(`master-payment:${receivableId}:${normalized(importKey)}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function confirmedMinorUnits(value: string): bigint {
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error("Invalid authoritative confirmed payment amount.");
  return BigInt(match[1]) * BigInt(100) + BigInt((match[2] ?? "").padEnd(2, "0"));
}

function balance(target: MasterPaymentTarget, paidMinor: bigint): MasterPaymentBalance {
  const billMinor = parseMoneyToMinorUnits(target.billAmount);
  return {
    billAmount: minorUnitsToDecimal(billMinor),
    confirmedPaidAmount: minorUnitsToDecimal(paidMinor),
    outstandingAmount: minorUnitsToDecimal(billMinor - paidMinor),
    paymentState: derivePaymentState(target.lifecycleStatus, billMinor, paidMinor),
  };
}

function sameEvent(existing: MasterImportedPaymentAuthority, payload: MasterPaymentPayload): boolean {
  return existing.verification_status === "confirmed"
    && minorUnitsToDecimal(parseMoneyToMinorUnits(existing.amount)) === payload.amount
    && existing.payment_date === payload.payment_date
    && (existing.payment_mode?.trim() ?? "") === payload.payment_mode
    && (existing.payment_reference?.trim() ?? "") === payload.payment_reference
    && (existing.note ?? "") === payload.note;
}

export function targetsForMasterPayments(
  paymentRows: MasterPaymentRow[],
  plannedReceivables: PlannedMasterReceivableRow[],
  resolutions: MasterPaymentResolutionRow[],
): MasterPaymentTarget[] {
  const paymentRowsByNumber = new Map(paymentRows.map((row) => [row.rowNumber, row]));
  const targetsByBusinessKey = new Map<string, MasterPaymentTarget>();
  for (const resolution of resolutions) {
    const source = paymentRowsByNumber.get(resolution.row_number);
    if (!source) continue;
    const key = targetKey(source.distributorReference, source.billReference);
    const target = targetsByBusinessKey.get(key) ?? {
      receivableId: resolution.receivable_id,
      distributorReference: source.distributorReference,
      billReference: resolution.bill_reference,
      billAmount: resolution.bill_amount,
      confirmedPaidAmount: resolution.confirmed_paid_amount,
      nextFollowUpDate: resolution.next_follow_up_date,
      lifecycleStatus: resolution.lifecycle_status,
      importedPayments: [],
    };
    if (target.receivableId !== resolution.receivable_id) {
      targetsByBusinessKey.delete(key);
      continue;
    }
    if (resolution.payment_id && resolution.import_key && resolution.payment_amount && resolution.payment_date && resolution.verification_status) {
      if (!target.importedPayments.some((payment) => payment.payment_id === resolution.payment_id)) {
        target.importedPayments.push({
          payment_id: resolution.payment_id,
          import_key: resolution.import_key,
          amount: resolution.payment_amount,
          payment_date: resolution.payment_date,
          payment_mode: resolution.payment_mode,
          payment_reference: resolution.payment_reference,
          note: resolution.payment_note,
          verification_status: resolution.verification_status,
        });
      }
    }
    targetsByBusinessKey.set(key, target);
  }
  for (const planned of plannedReceivables) {
    const key = targetKey(planned.distributorReference, planned.billReference);
    if (!planned.payload || !planned.resolvedReceivableId) {
      targetsByBusinessKey.delete(key);
      continue;
    }
    if (planned.classification === "NEW") {
      targetsByBusinessKey.set(key, {
        receivableId: planned.resolvedReceivableId,
        distributorReference: planned.distributorReference,
        billReference: planned.billReference,
        billAmount: planned.billAmount,
        confirmedPaidAmount: "0.00",
        nextFollowUpDate: planned.nextFollowUpDate,
        lifecycleStatus: "active",
        importedPayments: [],
        deferFollowUpValidation: true,
      });
    } else {
      const target = targetsByBusinessKey.get(key);
      if (target) {
        target.nextFollowUpDate = planned.nextFollowUpDate || null;
        target.deferFollowUpValidation = true;
      }
    }
  }
  return [...targetsByBusinessKey.values()];
}

export function planMasterPaymentRows(rows: MasterPaymentRow[], targets: MasterPaymentTarget[], today: string): PlannedMasterPaymentRow[] {
  if (rows.length > MAX_PAYMENT_ROWS) throw new Error("Maximum 5,000 Payment rows allowed.");
  const targetsByKey = new Map<string, MasterPaymentTarget[]>();
  for (const target of targets) {
    const key = targetKey(target.distributorReference, target.billReference);
    const matches = targetsByKey.get(key) ?? [];
    matches.push(target);
    if (!targetsByKey.has(key)) targetsByKey.set(key, matches);
  }
  const runningPaid = new Map<string, bigint>();
  const seenKeys = new Map<string, MasterPaymentPayload>();
  const planned: PlannedMasterPaymentRow[] = rows.map((row): PlannedMasterPaymentRow => {
    const matches = targetsByKey.get(targetKey(row.distributorReference, row.billReference)) ?? [];
    if (matches.length !== 1) return { ...row, classification: "INVALID_RECEIVABLE", reason: matches.length ? "Payment target resolves ambiguously." : "Payment must target one exact canonical Receivable.", before: null, after: null, existingPayment: null, payload: null };
    const target = matches[0];
    const billMinor = parseMoneyToMinorUnits(target.billAmount);
    const authoritativePaid = confirmedMinorUnits(target.confirmedPaidAmount);
    const paidBefore = runningPaid.get(target.receivableId) ?? authoritativePaid;
    const before = balance(target, paidBefore);
    if (target.lifecycleStatus === "cancelled") return { ...row, classification: "INVALID_RECEIVABLE_STATE", reason: "Cancelled Receivables cannot accept confirmed payments.", resolvedReceivableId: target.receivableId, before, after: null, existingPayment: null, payload: null };
    if (row.paymentDate > today) return { ...row, classification: "FUTURE_PAYMENT_DATE", reason: "Payment Date cannot be in the future in India.", resolvedReceivableId: target.receivableId, before, after: null, existingPayment: null, payload: null };
    const normalizedImportKey = normalized(row.paymentImportKey);
    const existingMatches = target.importedPayments.filter((payment) => normalized(payment.import_key) === normalizedImportKey);
    const payload: MasterPaymentPayload = {
      payment_id: existingMatches[0]?.payment_id ?? stablePaymentId(target.receivableId, row.paymentImportKey),
      receivable_id: target.receivableId,
      import_key: row.paymentImportKey,
      amount: row.paymentAmount,
      payment_date: row.paymentDate,
      payment_mode: row.paymentMode,
      payment_reference: row.paymentReference,
      note: row.notes,
    };
    if (existingMatches.length > 1) return { ...row, classification: "CONFLICTING_DUPLICATE", reason: "Multiple payment events have this import identity.", resolvedReceivableId: target.receivableId, before, after: null, existingPayment: existingMatches[0], payload: null };
    const existing = existingMatches[0] ?? null;
    if (existing) {
      const exact = sameEvent(existing, payload);
      return { ...row, classification: exact ? "EXACT_DUPLICATE" : "CONFLICTING_DUPLICATE", reason: exact ? "This confirmed payment event already exists." : "This payment import identity already exists with different or ineffective details.", resolvedReceivableId: target.receivableId, before, after: exact ? before : null, existingPayment: existing, payload: exact ? payload : null };
    }
    const paymentIdentity = `${target.receivableId}|${normalizedImportKey}`;
    const earlier = seenKeys.get(paymentIdentity);
    if (earlier) {
      const exact = JSON.stringify({ ...earlier, payment_id: "" }) === JSON.stringify({ ...payload, payment_id: "" });
      return { ...row, classification: exact ? "EXACT_DUPLICATE" : "CONFLICTING_DUPLICATE", reason: exact ? "This workbook repeats the exact payment event." : "This workbook repeats the payment import identity with different details.", resolvedReceivableId: target.receivableId, before, after: exact ? before : null, existingPayment: null, payload: exact ? earlier : null };
    }
    seenKeys.set(paymentIdentity, payload);
    const paymentMinor = parseMoneyToMinorUnits(row.paymentAmount);
    if (paymentMinor > billMinor - paidBefore) return { ...row, classification: "OVERPAYMENT", reason: "Confirmed payment exceeds the exact Receivable outstanding amount.", resolvedReceivableId: target.receivableId, before, after: null, existingPayment: null, payload: null };
    const paidAfter = paidBefore + paymentMinor;
    runningPaid.set(target.receivableId, paidAfter);
    return { ...row, classification: "NEW", resolvedReceivableId: target.receivableId, before, after: balance(target, paidAfter), existingPayment: null, payload };
  });
  for (const target of targets) {
    if (target.deferFollowUpValidation || (target.nextFollowUpDate && target.nextFollowUpDate >= today)) continue;
    const indices = planned.flatMap((payment, index) => payment.resolvedReceivableId === target.receivableId && payment.classification === "NEW" ? [index] : []);
    if (!indices.length) continue;
    const finalIndex = indices[indices.length - 1];
    const final = planned[finalIndex];
    if (final.after?.outstandingAmount !== "0.00") {
      planned[finalIndex] = { ...final, classification: "NEXT_FOLLOW_UP_REQUIRED", reason: "A current or future follow-up date is required while money remains outstanding after the complete planned payment set.", after: null, payload: null };
    }
  }
  return planned;
}

export function masterPaymentMutationRows(rows: PlannedMasterPaymentRow[]): Array<MasterPaymentPayload & { row_number: number }> {
  const blocking = rows.find((row) => !row.payload);
  if (blocking) throw new Error(`Payments row ${blocking.rowNumber} is blocking: ${blocking.classification}.`);
  return rows.filter((row) => ["NEW", "EXACT_DUPLICATE"].includes(row.classification)).map((row) => ({ ...row.payload!, row_number: row.rowNumber }));
}
