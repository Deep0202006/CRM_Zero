import { apiError, contextFor, isReceivablesReady } from "@/lib/receivables/server";
import { distributorReady } from "@/lib/distributors/server";
export const dynamic="force-dynamic";
export async function GET(request:Request){
 const receivablesEnabled=isReceivablesReady(),renewalsEnabled=distributorReady();if(!receivablesEnabled&&!renewalsEnabled)return Response.json({enabled:false,urgentCount:0,outstandingAmount:"0.00",rows:[],renewals_due_soon:{total:0,rows:[]}});
 const context=await contextFor(request);if(!context)return apiError(401,"AUTH_REQUIRED","Sign in again.");
 const renewalPromise=renewalsEnabled?context.service.rpc("distributor_renewals_due_v1",{p_actor_id:context.userId,p_admin:context.isAdmin,p_limit:5}):Promise.resolve({data:{total:0,rows:[]},error:null});
 if(context.isAdmin){const [payments,renewals]=await Promise.all([receivablesEnabled?context.service.from("receivable_payments").select("payment_id",{count:"exact",head:true}).eq("verification_status","reported"):Promise.resolve({count:0,error:null}),renewalPromise]);if(payments.error||renewals.error)return apiError(503,"READ_FAILED","Payment Collection priorities could not be loaded.");return Response.json({enabled:true,admin:true,verificationPending:payments.count??0,urgentCount:0,outstandingAmount:"0.00",rows:[],renewals_due_soon:renewals.data??{total:0,rows:[]}})}
 const [collections,renewals]=await Promise.all([receivablesEnabled?context.service.rpc("receivables_my_day_v1",{p_actor_id:context.userId}):Promise.resolve({data:{urgentCount:0,outstandingAmount:"0.00",rows:[]},error:null}),renewalPromise]);if(collections.error||renewals.error)return apiError(503,"READ_FAILED","Payment Collection priorities could not be loaded.");return Response.json({enabled:true,...collections.data,renewals_due_soon:renewals.data??{total:0,rows:[]}})
}
