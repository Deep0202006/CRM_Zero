import { createHash } from "crypto";

export interface ErpSystem {
  erp_id: string;
  erp_name: string;
  erp_key: string;
}

export function normalizeErpName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

export function normalizeErpKey(value: string): string {
  return normalizeErpName(value).toLocaleLowerCase("en-IN");
}

export function stableErpId(value: string): string {
  const hex = createHash("md5")
    .update(`erp:${normalizeErpKey(value)}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
