import "server-only";
import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizedIdentity,
  validateStatusCombination,
} from "@/lib/distributors/domain";
import {
  listEligibleOperationalEmployees,
  type EligibleEmployee,
} from "@/lib/employees/server";
import { MASTER_CLEAR_TOKEN, type MasterDistributorRow } from "./workbook";
import {
  stableErpId,
  normalizeErpKey,
  normalizeErpName,
  type ErpSystem,
} from "@/lib/erp/domain";
import { resolveErpNames } from "@/lib/erp/server";

const DISTRIBUTOR_READ_CHUNK = 100;
const MAX_DISTRIBUTOR_ROWS = 5_000;
const DISTRIBUTOR_COLUMNS =
  "distributor_id,identity_key,erp_id,distributor_name,distributor_reference,lead_id,phone,city,assigned_to,installation_status,installation_completed_at,training_status,training_completed_at,mapping_status,mapped_at,activity_status,billing_status,billed_at,bill_reference,renewal_date,version";

export const MASTER_DISTRIBUTOR_CLASSIFICATIONS = [
  "NEW",
  "UPDATE",
  "EXACT_DUPLICATE",
  "INVALID_EMPLOYEE",
  "IDENTITY_CONFLICT",
] as const;
export type MasterDistributorClassification =
  (typeof MASTER_DISTRIBUTOR_CLASSIFICATIONS)[number];

export interface MasterDistributorAuthority {
  distributor_id: string;
  identity_key: string;
  erp_id?: string | null;
  erp_name?: string | null;
  distributor_name: string;
  distributor_reference: string | null;
  lead_id: string | null;
  phone: string | null;
  city: string | null;
  assigned_to: string;
  installation_status: string;
  installation_completed_at: string | null;
  training_status: string;
  training_completed_at: string | null;
  mapping_status: string | null;
  mapped_at: string | null;
  activity_status: string;
  billing_status: string;
  billed_at: string | null;
  bill_reference: string | null;
  renewal_date: string | null;
  version: number;
}

export interface MasterDistributorPayload {
  distributor_id: string;
  expected_version?: number;
  erp_id: string | null;
  erp_name?: string;
  distributor_name: string;
  distributor_reference: string;
  lead_id: string | null;
  phone: string;
  city: string;
  assigned_to: string;
  installation_status: "pending" | "done";
  installation_completed_at: string | null;
  training_status: "pending" | "done";
  training_completed_at: string | null;
  mapping_status: "pending" | "done" | null;
  mapped_at: string | null;
  activity_status: "not_applicable" | "active" | "inactive";
  billing_status: "not_billed" | "billed";
  billed_at: string | null;
  bill_reference: string;
  renewal_date: string | null;
  note: string;
  identity_key: string;
}

export interface PlannedMasterDistributorRow extends MasterDistributorRow {
  classification: MasterDistributorClassification;
  reason?: string;
  assignedEmployeeName?: string;
  before: MasterDistributorAuthority | null;
  after: MasterDistributorPayload | null;
  payload: MasterDistributorPayload | null;
}

function referenceKey(reference: string): string {
  return reference
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-IN")
    .replace(/\s+/g, " ");
}

function stableDistributorId(operationId: string, reference: string): string {
  const hex = createHash("sha256")
    .update(`master-distributor:${operationId}:${referenceKey(reference)}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function comparable(
  value: MasterDistributorAuthority | MasterDistributorPayload,
) {
  return {
    erp_id: value.erp_id ?? null,
    distributor_name: value.distributor_name,
    distributor_reference: referenceKey(value.distributor_reference ?? ""),
    lead_id: value.lead_id ?? null,
    phone: value.phone ?? "",
    city: value.city ?? "",
    assigned_to: value.assigned_to,
    installation_status: value.installation_status,
    installation_completed_at: value.installation_completed_at ?? null,
    training_status: value.training_status,
    training_completed_at: value.training_completed_at ?? null,
    mapping_status: value.mapping_status ?? null,
    mapped_at: value.mapped_at ?? null,
    activity_status: value.activity_status,
    billing_status: value.billing_status,
    billed_at: value.billed_at ?? null,
    bill_reference: value.bill_reference ?? "",
    renewal_date: value.renewal_date ?? null,
    identity_key: value.identity_key,
  };
}

function sameCanonicalState(
  current: MasterDistributorAuthority,
  payload: MasterDistributorPayload,
): boolean {
  return (
    JSON.stringify(comparable(current)) === JSON.stringify(comparable(payload))
  );
}

function requiredPatch(
  value: string,
  current: string | null | undefined,
  label: string,
): string {
  const result = value || current || "";
  if (!result) throw new Error(`${label} is required for a new Distributor.`);
  return result;
}

function nullablePatch(
  value: string,
  current: string | null | undefined,
): string | null {
  if (value === MASTER_CLEAR_TOKEN) return null;
  if (value) return value;
  return current ?? null;
}

function nullableTextPatch(
  value: string | undefined,
  current: string | null | undefined,
): string {
  if (value === MASTER_CLEAR_TOKEN) return "";
  if (value) return value;
  return current ?? "";
}

function payloadFor(
  row: MasterDistributorRow,
  employee: EligibleEmployee,
  current: MasterDistributorAuthority | null,
  operationId: string,
  erps: Map<string, ErpSystem & { isNew: boolean }>,
): MasterDistributorPayload {
  const installationStatus = requiredPatch(
    row.installationStatus,
    current?.installation_status,
    "Installation Status",
  ) as "pending" | "done";
  const trainingStatus = requiredPatch(
    row.trainingStatus,
    current?.training_status,
    "Training Status",
  ) as "pending" | "done";
  const mappingStatus = (row.mappingStatus ||
    current?.mapping_status ||
    (current ? null : "")) as "pending" | "done" | null | "";
  const activityStatus = requiredPatch(
    row.activityStatus,
    current?.activity_status,
    "Activity Status",
  ) as "not_applicable" | "active" | "inactive";
  const billingStatus = requiredPatch(
    row.billingStatus,
    current?.billing_status,
    "Billing Status",
  ) as "not_billed" | "billed";
  if (!current && !mappingStatus)
    throw new Error("Mapping Status is required for a new Distributor.");
  const erpInput = (row.erpName ?? "").trim();
  const clearErp = erpInput.toLocaleUpperCase("en-IN") === MASTER_CLEAR_TOKEN;
  if (!current && (!erpInput || clearErp))
    throw new Error("ERP is required for a new Distributor.");
  const resolvedErp =
    erpInput && !clearErp
      ? (erps.get(normalizeErpKey(erpInput)) ?? {
        erp_id: stableErpId(erpInput),
          erp_name: normalizeErpName(erpInput),
          erp_key: normalizeErpKey(erpInput),
          isNew: true,
        })
      : undefined;
  if (erpInput && !clearErp && !resolvedErp)
    throw new Error("ERP could not be resolved.");
  const installationDate = nullablePatch(
    row.installationDate,
    current?.installation_completed_at,
  );
  const trainingDate = nullablePatch(
    row.trainingDate,
    current?.training_completed_at,
  );
  const mappedDate = nullablePatch(row.mappedDate, current?.mapped_at);
  const billDate = nullablePatch(row.billDate, current?.billed_at);
  if ((installationStatus === "done") !== Boolean(installationDate))
    throw new Error(
      "Installation Date is required only when Installation Status is done.",
    );
  if ((trainingStatus === "done") !== Boolean(trainingDate))
    throw new Error(
      "Training Date is required only when Training Status is done.",
    );
  if ((mappingStatus === "done") !== Boolean(mappedDate))
    throw new Error(
      "Mapped Date is required only when Mapping Status is done.",
    );
  if ((billingStatus === "billed") !== Boolean(billDate))
    throw new Error(
      "Bill Date is required only when Billing Status is billed.",
    );
  const combination = validateStatusCombination({
    installation_status: installationStatus,
    training_status: trainingStatus,
    mapping_status: mappingStatus || null,
    mapped_at: mappedDate,
    activity_status: activityStatus,
  });
  if (combination) throw new Error(combination);
  return {
    distributor_id:
      current?.distributor_id ??
      stableDistributorId(operationId, row.distributorReference),
    ...(current ? { expected_version: current.version } : {}),
    erp_id: clearErp ? null : (resolvedErp?.erp_id ?? current?.erp_id ?? null),
    ...(resolvedErp ? { erp_name: resolvedErp.erp_name } : {}),
    distributor_name: requiredPatch(
      row.distributorName,
      current?.distributor_name,
      "Distributor Name",
    ),
    distributor_reference:
      current?.distributor_reference ?? row.distributorReference,
    lead_id: current?.lead_id ?? null,
    phone: nullableTextPatch(row.phone, current?.phone),
    city: nullableTextPatch(row.city, current?.city),
    assigned_to: employee.user_id,
    installation_status: installationStatus,
    installation_completed_at: installationDate,
    training_status: trainingStatus,
    training_completed_at: trainingDate,
    mapping_status: mappingStatus || null,
    mapped_at: mappedDate,
    activity_status: activityStatus,
    billing_status: billingStatus,
    billed_at: billDate,
    bill_reference:
      nullablePatch(row.operationalBillReference, current?.bill_reference) ??
      "",
    renewal_date: nullablePatch(row.renewalDate, current?.renewal_date),
    note: row.notes ?? "",
    identity_key:
      current?.identity_key ?? normalizedIdentity("", row.distributorReference),
  };
}

export function planMasterDistributorRows(
  operationId: string,
  rows: MasterDistributorRow[],
  employees: EligibleEmployee[],
  authorities: MasterDistributorAuthority[],
  erps: Map<string, ErpSystem & { isNew: boolean }> = new Map(),
): PlannedMasterDistributorRow[] {
  if (rows.length > MAX_DISTRIBUTOR_ROWS)
    throw new Error("Maximum 5,000 Distributor rows allowed.");
  const employeesByEmail = new Map(
    employees.map((employee) => [
      employee.email.trim().toLocaleLowerCase("en-IN"),
      employee,
    ]),
  );
  const employeesById = new Map(
    employees.map((employee) => [employee.user_id, employee]),
  );
  const authoritiesByIdentity = new Map<string, MasterDistributorAuthority[]>();
  for (const authority of authorities) {
    const authorityKey = referenceKey(authority.identity_key);
    const entries = authoritiesByIdentity.get(authorityKey) ?? [];
    entries.push(authority);
    if (!authoritiesByIdentity.has(authorityKey))
      authoritiesByIdentity.set(authorityKey, entries);
  }
  const seenReferences = new Set<string>();
  return rows.map((row) => {
    const key = referenceKey(row.distributorReference);
    const identityKey = normalizedIdentity("", row.distributorReference);
    const matches = authoritiesByIdentity.get(identityKey) ?? [];
    const before = matches.length === 1 ? matches[0] : null;
    if (seenReferences.has(key))
      return {
        ...row,
        classification: "IDENTITY_CONFLICT",
        reason: "Distributor Reference is repeated in this workbook.",
        before,
        after: null,
        payload: null,
      };
    seenReferences.add(key);
    if (matches.length > 1)
      return {
        ...row,
        classification: "IDENTITY_CONFLICT",
        reason:
          "Multiple canonical accounts resolve to this Distributor Reference.",
        before: null,
        after: null,
        payload: null,
      };
    if (before && referenceKey(before.distributor_reference ?? "") !== key)
      return {
        ...row,
        classification: "IDENTITY_CONFLICT",
        reason: "Canonical identity and Distributor Reference disagree.",
        before,
        after: null,
        payload: null,
      };
    const employee = row.assignedEmployeeEmail
      ? employeesByEmail.get(
          row.assignedEmployeeEmail.toLocaleLowerCase("en-IN"),
        )
      : before
        ? employeesById.get(before.assigned_to)
        : undefined;
    if (!employee)
      return {
        ...row,
        classification: "INVALID_EMPLOYEE",
        reason:
          "Assigned employee is missing, inactive, ambiguous, or an Admin.",
        before,
        after: null,
        payload: null,
      };
    let payload: MasterDistributorPayload;
    try {
      payload = payloadFor(row, employee, before, operationId, erps);
    } catch (cause) {
      return {
        ...row,
        classification: "IDENTITY_CONFLICT",
        reason:
          cause instanceof Error
            ? cause.message
            : "Distributor state is invalid.",
        before,
        after: null,
        payload: null,
      };
    }
    const classification = before
      ? sameCanonicalState(before, payload)
        ? "EXACT_DUPLICATE"
        : "UPDATE"
      : "NEW";
    const erpName = row.erpName ?? "";
    const erp =
      erpName && erpName !== MASTER_CLEAR_TOKEN
        ? erps.get(normalizeErpKey(erpName))
        : undefined;
    return {
      ...row,
      classification,
      assignedEmployeeName: employee.name,
      erpAction:
        erpName === MASTER_CLEAR_TOKEN
          ? "CLEAR"
          : !erpName
            ? "PRESERVE"
            : erp?.isNew
              ? "CREATE_ERP"
              : "SET",
      erpIsNew: erp?.isNew ?? false,
      before,
      after: payload,
      payload,
    };
  });
}

export async function resolveMasterDistributorRows(
  service: SupabaseClient,
  operationId: string,
  rows: MasterDistributorRow[],
): Promise<PlannedMasterDistributorRow[]> {
  if (rows.length > MAX_DISTRIBUTOR_ROWS)
    throw new Error("Maximum 5,000 Distributor rows allowed.");
  const directory = await listEligibleOperationalEmployees(service);
  if (directory.error) throw directory.error;
  const authorities = await readMasterDistributorAuthorities(
    service,
    rows.map((row) => row.distributorReference),
  );
  const erps = await resolveErpNames(
    service,
    rows
      .map((row) => row.erpName ?? "")
      .filter((value) => value && value !== MASTER_CLEAR_TOKEN),
  );
  return planMasterDistributorRows(
    operationId,
    rows,
    directory.employees,
    authorities,
    erps,
  );
}

export async function readMasterDistributorAuthorities(
  service: SupabaseClient,
  references: string[],
): Promise<MasterDistributorAuthority[]> {
  const identityKeys = [
    ...new Set(
      references.map((reference) => normalizedIdentity("", reference)),
    ),
  ];
  const authorities: MasterDistributorAuthority[] = [];
  for (
    let offset = 0;
    offset < identityKeys.length;
    offset += DISTRIBUTOR_READ_CHUNK
  ) {
    const { data, error } = await service
      .from("distributor_accounts")
      .select(DISTRIBUTOR_COLUMNS)
      .in(
        "identity_key",
        identityKeys.slice(offset, offset + DISTRIBUTOR_READ_CHUNK),
      );
    if (error) throw error;
    authorities.push(
      ...((data ?? []) as Omit<MasterDistributorAuthority, "erp_name">[]).map(
        (row) => ({ ...row, erp_name: null }),
      ),
    );
  }
  const erpIds = [
    ...new Set(
      authorities
        .map((row) => row.erp_id)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  if (erpIds.length) {
    const { data, error } = await service
      .from("erp_systems")
      .select("erp_id,erp_name")
      .in("erp_id", erpIds);
    if (error) throw error;
    const names = new Map(
      (data ?? []).map((row) => [String(row.erp_id), String(row.erp_name)]),
    );
    authorities.forEach((row) => {
      row.erp_name = row.erp_id ? (names.get(row.erp_id) ?? null) : null;
    });
  }
  return authorities;
}

export function masterDistributorMutationRows(
  rows: PlannedMasterDistributorRow[],
) {
  return rows.map((row) => ({
    rowNumber: row.rowNumber,
    classification: row.classification,
    payload: row.payload,
  }));
}
