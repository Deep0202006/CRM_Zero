import "server-only";
import { apiError, contextFor, requestHash } from "@/lib/receivables/server";
export function stableDistributorId(operationId:string){const hex=requestHash(`distributor:${operationId}`);return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`}
export function distributorReadError(error: { code?: string } | null | undefined, fallback = "Distributor Status could not be loaded.") {
  const missing = error?.code === "42P01" || error?.code === "42703" || error?.code === "PGRST202" || error?.code === "PGRST204";
  return apiError(503, missing ? "DISTRIBUTOR_CAPABILITY_MISSING" : "DISTRIBUTOR_SERVER_ERROR", missing ? "Distributor Status requires the reviewed owner migration." : fallback);
}
export {apiError,contextFor,requestHash};
