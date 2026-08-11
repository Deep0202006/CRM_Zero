import { apiError, contextFor, isReceivablesReady } from "@/lib/receivables/server";
export const dynamic="force-dynamic";
export async function GET(request:Request){if(!isReceivablesReady())return Response.json({enabled:false,urgentCount:0,outstandingAmount:"0.00",rows:[]});const context=await contextFor(request);if(!context)return apiError(401,"AUTH_REQUIRED","Sign in again.");if(context.isAdmin)return Response.json({enabled:true,urgentCount:0,outstandingAmount:"0.00",rows:[]});
 const {data,error}=await context.service.rpc("receivables_my_day_v1",{p_actor_id:context.userId});if(error)return apiError(503,"READ_FAILED","Payment follow-ups could not be loaded.");return Response.json(data);}
