export type FieldBusinessSegment = "Retailer" | "Distributor";
export type CurrentErpState = "erp" | "none" | null;
export type CurrentErpProvenance = "field_visit" | "manual_baseline" | "not_captured";

export interface CurrentBusinessErpRow {
  segment_type: FieldBusinessSegment;
  business_ref: string;
  business_name: string | null;
  erp_usage_state: CurrentErpState;
  erp_id: string | null;
  erp_name: string | null;
  latest_visit_at: string | null;
  effective_at: string | null;
  provenance: CurrentErpProvenance;
  source_ref: string | null;
}

export type CurrentErpEdit =
  | { operation: "set"; erp_id: string; erp_name?: never }
  | { operation: "set"; erp_name: string; erp_id?: never }
  | { operation: "none" }
  | { operation: "clear" };

export type CurrentErpOperation = CurrentErpEdit & {
  segment_type: FieldBusinessSegment;
  business_ref: string;
};

export function currentErpLabel(row: CurrentBusinessErpRow): string {
  if (row.erp_usage_state === "erp") return row.erp_name || "ERP unavailable";
  if (row.erp_usage_state === "none") return "None";
  return "Not captured";
}

export function operationForExistingErp(erpId: string): CurrentErpEdit | null {
  const value = erpId.trim();
  return value ? { operation: "set", erp_id: value } : null;
}

export function operationForCustomErp(erpName: string): CurrentErpEdit | null {
  const value = erpName.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!value || value.length > 160 || value.toLocaleLowerCase("en-IN") === "none") return null;
  return { operation: "set", erp_name: value };
}
