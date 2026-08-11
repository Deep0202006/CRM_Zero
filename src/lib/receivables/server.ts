import "server-only"; import { createHash } from "crypto"; import { createClient, type SupabaseClient } from "@supabase/supabase-js";
export interface ReceivablesContext { userId: string; isAdmin: boolean; userClient: SupabaseClient; service: SupabaseClient }
export function isReceivablesReady() { return process.env.RECEIVABLES_V1_READY === "true"; }
export function canonicalize(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`; if (value && typeof value === "object") return `{${Object.entries(value as Record<string,unknown>).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`; return JSON.stringify(value); }
export function requestHash(value: unknown) { return createHash("sha256").update(canonicalize(value)).digest("hex"); }
function bearer(request: Request) { const h=request.headers.get("authorization")??""; return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : null; }
export async function contextFor(request: Request): Promise<ReceivablesContext | null> {
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL, anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, key=process.env.SUPABASE_SERVICE_ROLE_KEY, token=bearer(request); if(!url||!anon||!key||!token) return null;
  const userClient=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false},global:{headers:{Authorization:`Bearer ${token}`}}}); const service=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:auth,error}=await userClient.auth.getUser(token); if(error||!auth.user)return null;
  const [{data:user},{data:caps}]=await Promise.all([service.from("users").select("user_id,is_active").eq("user_id",auth.user.id).maybeSingle(),service.from("user_capabilities").select("capability_code").eq("user_id",auth.user.id)]);
  if(!user||(user.is_active!==true&&user.is_active!==1))return null; return {userId:auth.user.id,isAdmin:(caps??[]).some(c=>c.capability_code==="admin"),userClient,service};
}
export function apiError(status:number,code:string,message:string,current?:unknown){return Response.json({success:false,code,message,...(current?{current}: {})},{status});}
export const commandMessages: Record<string,string>={RECEIVABLE_OPERATION_MISMATCH:"This operation ID was already used for different details.",RECEIVABLE_CONFLICT:"This collection changed. Review the latest details and try again.",PAYMENT_NOT_ELIGIBLE:"This payment is no longer eligible for that action.",RECEIVABLE_NOT_ASSIGNED:"This collection is no longer assigned to you.",ADMIN_REQUIRED:"System Administrator access is required.",CANCELLATION_UNSAFE:"A receivable with confirmed financial history cannot be cancelled.",NEXT_FOLLOW_UP_REQUIRED:"A next follow-up date is required while money remains outstanding."};

