import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizedIdentity } from "./domain";
import type { DistributorImportRow } from "./import";
import { requestHash } from "./server";
import { listEligibleOperationalEmployees } from "@/lib/employees/server";
import { normalizeErpKey } from "@/lib/erp/domain";
import { resolveErpNames } from "@/lib/erp/server";

export type DistributorImportClassification =
  | "NEW"
  | "UPDATE"
  | "EXACT_DUPLICATE"
  | "AMBIGUOUS"
  | "INVALID_EMPLOYEE"
  | "ERP_REQUIRED";
function stableId(operationId: string, rowNumber: number) {
  const hex = createHash("sha256")
    .update(`${operationId}:${rowNumber}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
const critical = (value: Record<string, unknown>) =>
  requestHash({
    erp_id: value.erp_id ?? null,
    distributor_name: value.distributor_name,
    distributor_reference: value.distributor_reference ?? "",
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
  });

export async function buildDistributorImportPreview(
  service: SupabaseClient,
  operationId: string,
  rows: DistributorImportRow[],
) {
  const directory = await listEligibleOperationalEmployees(service);
  if (directory.error) throw directory.error;
  const erps = await resolveErpNames(
    service,
    rows
      .map((row) => row.erpName ?? "")
      .filter((value) => value && value.toUpperCase() !== "[CLEAR]"),
  );
  const employees = new Map(
    directory.employees.map((user) => [String(user.email).toLowerCase(), user]),
  );
  const keys = [
      ...new Set(
        rows.map((row) =>
          normalizedIdentity(row.distributorName, row.distributorReference),
        ),
      ),
    ],
    existing: Record<string, unknown>[] = [];
  for (let offset = 0; offset < keys.length; offset += 100) {
    const { data, error } = await service
      .from("distributor_accounts")
      .select(
        "distributor_id,identity_key,erp_id,distributor_name,distributor_reference,assigned_to,installation_status,installation_completed_at,training_status,training_completed_at,mapping_status,mapped_at,activity_status,billing_status,billed_at,bill_reference,renewal_date,version",
      )
      .in("identity_key", keys.slice(offset, offset + 100));
    if (error) throw error;
    existing.push(...(data ?? []));
  }
  const byKey = new Map<string, Record<string, unknown>[]>();
  existing.forEach((record) =>
    byKey.set(String(record.identity_key), [
      ...(byKey.get(String(record.identity_key)) ?? []),
      record,
    ]),
  );
  const seen = new Set<string>();
  const classified = rows.map((row) => {
    const key = normalizedIdentity(
        row.distributorName,
        row.distributorReference,
      ),
      employee = employees.get(row.assignedEmployeeEmail),
      matches = byKey.get(key) ?? [];
    if (!employee)
      return {
        ...row,
        classification: "INVALID_EMPLOYEE" as const,
        reason:
          "Assigned employee is missing, inactive, Admin, or an ERP Partner Viewer.",
      };
    if (seen.has(key))
      return {
        ...row,
        classification: "AMBIGUOUS" as const,
        reason: "This file repeats a distributor identity.",
      };
    seen.add(key);
    if (matches.length > 1)
      return {
        ...row,
        classification: "AMBIGUOUS" as const,
        reason: "Multiple distributors match this identity.",
      };
    const current = matches[0],
      input = (row.erpName ?? "").trim(),
      clearing = input.toUpperCase() === "[CLEAR]",
      erp = input && !clearing ? erps.get(normalizeErpKey(input)) : undefined;
    if (!current && (!input || clearing))
      return {
        ...row,
        classification: "ERP_REQUIRED" as const,
        reason: "ERP is required for a new Distributor.",
      };
    const payload = {
      distributor_id:
        current?.distributor_id ?? stableId(operationId, row.rowNumber),
      expected_version: current?.version,
      erp_id: clearing ? null : (erp?.erp_id ?? current?.erp_id ?? null),
      ...(erp ? { erp_name: erp.erp_name } : {}),
      distributor_name: row.distributorName,
      distributor_reference: row.distributorReference,
      lead_id: null,
      phone: "",
      city: "",
      assigned_to: employee.user_id,
      installation_status: row.installationStatus,
      installation_completed_at: row.installationDate || null,
      training_status: row.trainingStatus,
      training_completed_at: row.trainingDate || null,
      mapping_status: row.mappingStatus,
      mapped_at: row.mappedDate || null,
      activity_status: row.activityStatus,
      billing_status: row.billingStatus,
      billed_at: row.billDate || null,
      bill_reference: row.billReference,
      renewal_date: row.renewalDate || null,
      note: "Imported from spreadsheet",
      identity_key: key,
    };
    const comparison = current && critical(payload) === critical(current);
    return {
      ...row,
      erp_name: erp?.erp_name ?? (clearing ? null : undefined),
      erp_is_new: erp?.isNew ?? false,
      classification: (comparison
        ? "EXACT_DUPLICATE"
        : current
          ? "UPDATE"
          : "NEW") as DistributorImportClassification,
      assigned_employee_name: employee.name,
      payload,
    };
  });
  const counts = classified.reduce<Record<string, number>>(
      (result, row) => (
        (result[row.classification] = (result[row.classification] ?? 0) + 1),
        result
      ),
      {},
    ),
    preview_hash = requestHash(
      classified.map((row) => ({
        rowNumber: row.rowNumber,
        classification: row.classification,
        payload: "payload" in row ? row.payload : null,
      })),
    );
  return { rows: classified, counts, preview_hash };
}
