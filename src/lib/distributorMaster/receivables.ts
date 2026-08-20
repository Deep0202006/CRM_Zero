import "server-only";
import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentISTDate } from "@/lib/dateTime";
import { canonicalMoney, minorUnitsToDecimal } from "@/lib/receivables/domain";
import { listEligibleOperationalEmployees, type EligibleEmployee } from "@/lib/employees/server";
import { readMasterDistributorAuthorities, type MasterDistributorAuthority, type PlannedMasterDistributorRow } from "./distributors";
import type { MasterReceivableRow } from "./workbook";
import type { PlannedMasterPaymentRow } from "./payments";

const MAX_RECEIVABLE_ROWS = 5_000;

export const MASTER_RECEIVABLE_CLASSIFICATIONS = ["NEW", "EXACT_DUPLICATE", "CONFLICTING_DUPLICATE", "INVALID_DISTRIBUTOR", "INVALID_DISTRIBUTOR_STATUS", "INVALID_EMPLOYEE", "INVALID_FOLLOW_UP_DATE"] as const;
export type MasterReceivableClassification = typeof MASTER_RECEIVABLE_CLASSIFICATIONS[number];

export interface MasterReceivableDistributor {
  distributorId: string;
  distributorName: string;
  distributorReference: string;
  billingStatus: string;
  assignedTo: string;
}

export interface MasterReceivableAuthority {
  receivable_id: string;
  distributor_id: string;
  bill_reference: string;
  bill_reference_key: string;
  contact_person: string;
  contact_phone: string | null;
  bill_amount: string;
  bill_due_date: string;
  next_follow_up_date: string | null;
  assigned_to: string;
  lifecycle_status: string;
  confirmed_paid_amount: string;
  version: number;
}

export interface MasterReceivablePayload {
  receivable_id: string;
  distributor_id: string;
  distributor_name: string;
  distributor_code: string;
  bill_reference: string;
  contact_person: string;
  contact_phone: string;
  bill_amount: string;
  bill_due_date: string;
  next_follow_up_date: string;
  assigned_to: string;
  notes: string;
}

export interface PlannedMasterReceivableRow extends MasterReceivableRow {
  classification: MasterReceivableClassification;
  reason?: string;
  assignedEmployeeName?: string;
  resolvedDistributor?: MasterReceivableDistributor;
  before: MasterReceivableAuthority | null;
  after: MasterReceivablePayload | null;
  payload: MasterReceivablePayload | null;
  resolvedReceivableId?: string;
}

function normalized(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-IN").replace(/\s+/g, " ");
}

function nonnegativeMinorUnits(value: string): bigint {
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new Error("Invalid authoritative Receivable balance.");
  return BigInt(match[1]) * BigInt(100) + BigInt((match[2] ?? "").padEnd(2, "0"));
}

function stableReceivableId(operationId: string, distributorId: string, billReference: string): string {
  const hex = createHash("sha256").update(`master-receivable:${operationId}:${distributorId}:${normalized(billReference)}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function authorityCritical(value: MasterReceivableAuthority) {
  return {
    distributor_id: value.distributor_id,
    bill_amount: canonicalMoney(value.bill_amount),
    bill_due_date: value.bill_due_date,
    next_follow_up_date: value.next_follow_up_date ?? "",
    assigned_to: value.assigned_to,
    contact_person: value.contact_person.trim(),
    contact_phone: value.contact_phone?.trim() ?? "",
  };
}

function payloadCritical(value: MasterReceivablePayload) {
  return {
    distributor_id: value.distributor_id,
    bill_amount: value.bill_amount,
    bill_due_date: value.bill_due_date,
    next_follow_up_date: value.next_follow_up_date,
    assigned_to: value.assigned_to,
    contact_person: value.contact_person.trim(),
    contact_phone: value.contact_phone.trim(),
  };
}

function sameObligation(authority: MasterReceivableAuthority, payload: MasterReceivablePayload): boolean {
  return JSON.stringify(authorityCritical(authority)) === JSON.stringify(payloadCritical(payload));
}

function fromAuthority(authority: MasterDistributorAuthority): MasterReceivableDistributor {
  return {
    distributorId: authority.distributor_id,
    distributorName: authority.distributor_name,
    distributorReference: authority.distributor_reference ?? "",
    billingStatus: authority.billing_status,
    assignedTo: authority.assigned_to,
  };
}

export function distributorsForMasterReceivables(planned: PlannedMasterDistributorRow[], existing: MasterDistributorAuthority[]): MasterReceivableDistributor[] {
  const byReference = new Map(existing.map((authority) => [normalized(authority.distributor_reference ?? ""), fromAuthority(authority)]));
  for (const row of planned) {
    if (!row.payload) {
      byReference.delete(normalized(row.distributorReference));
      continue;
    }
    byReference.set(normalized(row.distributorReference), {
      distributorId: row.payload.distributor_id,
      distributorName: row.payload.distributor_name,
      distributorReference: row.payload.distributor_reference,
      billingStatus: row.payload.billing_status,
      assignedTo: row.payload.assigned_to,
    });
  }
  return [...byReference.values()];
}

export function planMasterReceivableRows(
  operationId: string,
  rows: MasterReceivableRow[],
  employees: EligibleEmployee[],
  distributors: MasterReceivableDistributor[],
  authorities: MasterReceivableAuthority[],
): PlannedMasterReceivableRow[] {
  if (rows.length > MAX_RECEIVABLE_ROWS) throw new Error("Maximum 5,000 Receivable rows allowed.");
  const employeesById = new Map(employees.map((employee) => [employee.user_id, employee]));
  const distributorsByReference = new Map<string, MasterReceivableDistributor[]>();
  for (const distributor of distributors) {
    const key = normalized(distributor.distributorReference);
    const matches = distributorsByReference.get(key) ?? [];
    matches.push(distributor);
    if (!distributorsByReference.has(key)) distributorsByReference.set(key, matches);
  }
  const authoritiesByKey = new Map<string, MasterReceivableAuthority[]>();
  authorities.forEach((authority) => {
    const key = `${authority.distributor_id}|${authority.bill_reference_key}`;
    const matches = authoritiesByKey.get(key) ?? [];
    matches.push(authority);
    if (!authoritiesByKey.has(key)) authoritiesByKey.set(key, matches);
  });
  const seen = new Map<string, MasterReceivablePayload>();
  return rows.map((row) => {
    const matches = distributorsByReference.get(normalized(row.distributorReference)) ?? [];
    if (matches.length !== 1) return { ...row, classification: "INVALID_DISTRIBUTOR", reason: matches.length ? "Distributor Reference resolves ambiguously." : "Distributor Reference does not resolve to a canonical account.", before: null, after: null, payload: null };
    const distributor = matches[0];
    if (distributor.billingStatus !== "billed") return { ...row, classification: "INVALID_DISTRIBUTOR_STATUS", reason: "Canonical Distributor Status must be billed before a Receivable can be created.", resolvedDistributor: distributor, before: null, after: null, payload: null };
    const employee = employeesById.get(distributor.assignedTo);
    if (!employee) return { ...row, classification: "INVALID_EMPLOYEE", reason: "Assigned employee is missing, inactive, ambiguous, or an Admin.", resolvedDistributor: distributor, before: null, after: null, payload: null };
    const businessKey = `${distributor.distributorId}|${normalized(row.billReference)}`;
    const existing = authoritiesByKey.get(businessKey) ?? [];
    if (existing.length > 1) return { ...row, classification: "CONFLICTING_DUPLICATE", reason: "Multiple canonical Receivables have this exact business identity.", resolvedDistributor: distributor, before: existing[0], after: null, payload: null };
    const current = existing[0] ?? null;
    const proposed: MasterReceivablePayload = {
      receivable_id: current?.receivable_id ?? stableReceivableId(operationId, distributor.distributorId, row.billReference),
      distributor_id: distributor.distributorId,
      distributor_name: distributor.distributorName,
      distributor_code: distributor.distributorReference,
      bill_reference: row.billReference,
      contact_person: row.contactPerson,
      contact_phone: row.contactPhone,
      bill_amount: row.billAmount,
      bill_due_date: row.billDueDate,
      next_follow_up_date: row.nextFollowUpDate,
      assigned_to: employee.user_id,
      notes: row.notes,
    };
    const earlier = seen.get(businessKey);
    if (earlier) {
      const exact = JSON.stringify(payloadCritical(earlier)) === JSON.stringify(payloadCritical(proposed));
      return { ...row, classification: exact ? "EXACT_DUPLICATE" : "CONFLICTING_DUPLICATE", reason: exact ? "This workbook repeats the exact bill obligation." : "This workbook repeats the bill identity with conflicting values.", assignedEmployeeName: employee.name, resolvedDistributor: distributor, before: current, after: proposed, payload: exact ? proposed : null, resolvedReceivableId: current?.receivable_id ?? earlier.receivable_id };
    }
    seen.set(businessKey, proposed);
    if (current && !sameObligation(current, proposed)) return { ...row, classification: "CONFLICTING_DUPLICATE", reason: "An existing canonical Receivable has this bill identity with different obligation fields.", assignedEmployeeName: employee.name, resolvedDistributor: distributor, before: current, after: proposed, payload: null, resolvedReceivableId: current.receivable_id };
    const classification = current ? "EXACT_DUPLICATE" : "NEW";
    return { ...row, classification, assignedEmployeeName: employee.name, resolvedDistributor: distributor, before: current, after: proposed, payload: proposed, resolvedReceivableId: proposed.receivable_id };
  });
}

export async function resolveMasterReceivableRows(
  service: SupabaseClient,
  operationId: string,
  rows: MasterReceivableRow[],
  plannedDistributors: PlannedMasterDistributorRow[],
): Promise<PlannedMasterReceivableRow[]> {
  if (rows.length > MAX_RECEIVABLE_ROWS) throw new Error("Maximum 5,000 Receivable rows allowed.");
  const directory = await listEligibleOperationalEmployees(service);
  if (directory.error) throw directory.error;
  const plannedReferences = new Set(plannedDistributors.map((row) => normalized(row.distributorReference)));
  const missingReferences = [...new Set(rows.map((row) => row.distributorReference).filter((reference) => !plannedReferences.has(normalized(reference))))];
  const existingDistributors = await readMasterDistributorAuthorities(service, missingReferences);
  const distributors = distributorsForMasterReceivables(plannedDistributors, existingDistributors);
  const byReference = new Map(distributors.map((distributor) => [normalized(distributor.distributorReference), distributor]));
  const resolutionInput = rows.flatMap((row) => {
    const distributor = byReference.get(normalized(row.distributorReference));
    return distributor ? [{ row_number: row.rowNumber, distributor_id: distributor.distributorId, bill_reference_key: normalized(row.billReference) }] : [];
  });
  const { data, error } = await service.rpc("resolve_distributor_master_receivables_v1", { p_rows: resolutionInput });
  if (error) throw error;
  return finalizeMasterReceivableFollowUps(
    planMasterReceivableRows(operationId, rows, directory.employees, distributors, (data ?? []) as MasterReceivableAuthority[]),
    [],
    getCurrentISTDate(),
  );
}

export function masterReceivableMutationRows(rows: PlannedMasterReceivableRow[]): Array<MasterReceivablePayload & { row_number: number }> {
  const blocking = rows.find((row) => !row.payload);
  if (blocking) throw new Error(`Receivables row ${blocking.rowNumber} is blocking: ${blocking.classification}.`);
  return rows.filter((row) => ["NEW", "EXACT_DUPLICATE"].includes(row.classification)).map((row) => ({ ...row.payload!, row_number: row.rowNumber }));
}

export function finalizeMasterReceivableFollowUps(
  rows: PlannedMasterReceivableRow[],
  payments: PlannedMasterPaymentRow[],
  today: string,
): PlannedMasterReceivableRow[] {
  const paymentsByReceivable = new Map<string, PlannedMasterPaymentRow[]>();
  for (const payment of payments) {
    if (!payment.resolvedReceivableId) continue;
    const related = paymentsByReceivable.get(payment.resolvedReceivableId) ?? [];
    related.push(payment);
    if (!paymentsByReceivable.has(payment.resolvedReceivableId)) paymentsByReceivable.set(payment.resolvedReceivableId, related);
  }
  return rows.map((row) => {
    if (!row.payload || !row.resolvedReceivableId) return row;
    const related = paymentsByReceivable.get(row.resolvedReceivableId) ?? [];
    if (related.some((payment) => !["NEW", "EXACT_DUPLICATE"].includes(payment.classification))) return row;
    const finalPayment = [...related].reverse().find((payment) => payment.after);
    const outstanding = finalPayment?.after?.outstandingAmount
      ?? (row.before
        ? minorUnitsToDecimal(nonnegativeMinorUnits(row.before.bill_amount) - nonnegativeMinorUnits(row.before.confirmed_paid_amount))
        : row.billAmount);
    if (nonnegativeMinorUnits(outstanding) > BigInt(0) && (!row.nextFollowUpDate || row.nextFollowUpDate < today)) {
      return { ...row, classification: "INVALID_FOLLOW_UP_DATE", reason: "A current or future Payment Follow-up Date is required when the complete planned payment result remains outstanding.", after: row.after, payload: null };
    }
    return row;
  });
}
