"use client";
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { canonicalMoney } from "@/lib/receivables/domain";
import { getCurrentISTDate } from "@/lib/dateTime";

export type AdminAction="direct_payment"|"confirm_payment"|"reject_payment"|"reverse_payment"|"reassign"|"update"|"dispute"|"resolve_dispute"|"cancel";
export function AdminReceivableActionModal({action,open,onClose,onSubmit,users,partialPayment}:{action:AdminAction;open:boolean;onClose:()=>void;onSubmit:(payload:Record<string,unknown>)=>Promise<void>;users:{user_id:string;name:string;email:string}[];partialPayment?:boolean}){
 const [busy,setBusy]=useState(false),[error,setError]=useState("");const today=getCurrentISTDate();const titles:Record<AdminAction,string>={direct_payment:"Record Payment",confirm_payment:"Confirm Payment",reject_payment:"Reject Payment Report",reverse_payment:"Reverse Payment",reassign:"Reassign Collection",update:"Correct Receivable",dispute:"Mark Disputed",resolve_dispute:"Resolve Dispute",cancel:"Cancel Receivable"};
 async function submit(event:React.FormEvent<HTMLFormElement>){event.preventDefault();if(busy)return;setBusy(true);setError("");const raw=Object.fromEntries(new FormData(event.currentTarget).entries());try{const payload:Record<string,unknown>={};for(const [key,value] of Object.entries(raw))if(value!=="")payload[key]=["amount","bill_amount"].includes(key)?canonicalMoney(String(value)):value;await onSubmit(payload);onClose()}catch(cause){setError(cause instanceof Error?cause.message:"The action was not confirmed. Your entries are retained.")}finally{setBusy(false)}}
 const reason=["reject_payment","reverse_payment","dispute","cancel"].includes(action),formId=`admin-receivable-${action}`;
 return <Modal open={open} onClose={()=>!busy&&onClose()} title={titles[action]} description="The server rechecks authorization, version, and financial invariants before committing." footer={<><Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" form={formId} isLoading={busy}>Confirm</Button></>}><form id={formId} className="space-y-4" onSubmit={submit}>
  {action==="direct_payment"&&<><Input data-autofocus name="amount" label="Amount" required/><Input name="payment_date" label="Payment date" type="date" defaultValue={today} max={today} required/><Input name="payment_mode" label="Payment mode" maxLength={60}/><Input name="payment_reference" label="Reference" maxLength={160}/><Input name="next_follow_up_date" label="Next follow-up date (required for a partial payment if none is active)" type="date" min={today}/></>}
  {action==="confirm_payment"&&partialPayment&&<Input data-autofocus name="next_follow_up_date" label="Next follow-up date" type="date" min={today} required/>}
  {action==="reverse_payment"&&<Input name="next_follow_up_date" label="Next follow-up date" type="date" min={today}/>} 
  {action==="reassign"&&<label className="block text-xs font-semibold">Assigned employee<select data-autofocus required name="assigned_to" className="field-control mt-1.5 w-full"><option value="">Select active employee</option>{users.map(user=><option key={user.user_id} value={user.user_id}>{user.name} · {user.email}</option>)}</select></label>}
  {action==="update"&&<div className="grid gap-3 sm:grid-cols-2"><Input name="bill_amount" label="Bill amount"/><Input name="bill_due_date" label="Bill due date" type="date"/><Input name="next_follow_up_date" label="Next follow-up" type="date" min={today}/><Input name="contact_person" label="Contact person" maxLength={160}/><Input name="contact_phone" label="Contact phone" maxLength={40}/></div>}
  {reason&&<label className="block text-xs font-semibold">Reason *<textarea data-autofocus required name="reason" maxLength={500} className="field-control mt-1.5 min-h-24 w-full"/></label>}
  {!reason&&action!=="confirm_payment"&&<label className="block text-xs font-semibold">Note<textarea name="note" maxLength={1000} className="field-control mt-1.5 min-h-20 w-full"/></label>}
  {error&&<div role="alert" className="alert-panel alert-panel--danger">{error}</div>}
 </form></Modal>
}
