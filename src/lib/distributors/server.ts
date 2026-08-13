import "server-only";
import { apiError, contextFor, requestHash } from "@/lib/receivables/server";
export const distributorReady=()=>true;
export function stableDistributorId(operationId:string){const hex=requestHash(`distributor:${operationId}`);return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`}
export {apiError,contextFor,requestHash};
