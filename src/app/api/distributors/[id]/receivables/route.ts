import { apiError,contextFor,isReceivablesReady } from "@/lib/receivables/server";

export const dynamic="force-dynamic";
type RouteContext={params:Promise<{id:string}>};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request:Request,routeContext:RouteContext){
 if(!isReceivablesReady())return apiError(503,"RECEIVABLES_UNAVAILABLE","Payment Collections are not activated yet.");
 const context=await contextFor(request);if(!context)return apiError(401,"AUTH_REQUIRED","Sign in again.");
 const {id}=await routeContext.params;if(!uuid.test(id))return apiError(400,"INVALID_DISTRIBUTOR","Choose a canonical Distributor Status record.");
 const {data,error}=await context.service.rpc("distributor_outstanding_receivables_v1",{p_actor_id:context.userId,p_distributor_id:id,p_limit:50});
 if(error)return apiError(503,"DISTRIBUTOR_RECEIVABLES_UNAVAILABLE","Outstanding Receivables could not be loaded. Financial data is unchanged.");
 const result=data as {total:number;rows:unknown[]};return Response.json({total:Number(result?.total??0),rows:result?.rows??[],limit:50,has_more:Number(result?.total??0)>50});
}
