"use client";
import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { canonicalMoney } from "@/lib/receivables/domain";
import { getCurrentISTDate } from "@/lib/dateTime";

export type EmployeeReceivableAction="contacted"|"no_response"|"promise"|"payment_report";
export function EmployeeReceivableActionModal({action,open,onClose,onSubmit}:{action:EmployeeReceivableAction;open:boolean;onClose:()=>void;onSubmit:(payload:Record<string,unknown>)=>Promise<void>}){
 const today=getCurrentISTDate();const [busy,setBusy]=useState(false),[error,setError]=useState("");const title={contacted:"Contacted",no_response:"No Response",promise:"Promise to Pay",payment_report:"Payment Reported"}[action];
 async function submit(event:React.FormEvent<HTMLFormElement>){event.preventDefault();if(busy)return;setBusy(true);setError("");const values=Object.fromEntries(new FormData(event.currentTarget).entries());try{const payload:Record<string,unknown>={};if(action==="contacted"||action==="no_response"){payload.next_follow_up_date=values.next_follow_up_date;payload.note=values.note||undefined}else if(action==="promise"){payload.promise_date=values.promise_date;payload.promise_amount=values.promise_amount?canonicalMoney(String(values.promise_amount)):undefined;payload.note=values.note||undefined}else{payload.amount=canonicalMoney(String(values.amount));payload.payment_date=values.payment_date;payload.payment_mode=values.payment_mode||undefined;payload.payment_reference=values.payment_reference||undefined;payload.note=values.note||undefined}await onSubmit(payload);onClose()}catch(cause){setError(cause instanceof Error?cause.message:"The action was not confirmed. Your entries are retained.")}finally{setBusy(false)}}
 const formId=`receivable-${action}-form`;
 return <Modal open={open} onClose={()=>!busy&&onClose()} title={title} description="This action is authoritative only after the server confirms it." footer={<><Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button><Button type="submit" form={formId} isLoading={busy}>Confirm {title}</Button></>}>
  <form id={formId} className="space-y-4" onSubmit={submit}>
   {(action==="contacted"||action==="no_response")&&<Input data-autofocus label="Next follow-up date" name="next_follow_up_date" type="date" min={today} required/>}
   {action==="promise"&&<><Input data-autofocus label="Promise date" name="promise_date" type="date" min={today} required/><Input label="Promised amount" name="promise_amount" inputMode="decimal" placeholder="Optional, e.g. ₹84,500"/></>}
   {action==="payment_report"&&<><Input data-autofocus label="Amount" name="amount" inputMode="decimal" placeholder="e.g. ₹84,500" required/><Input label="Payment date" name="payment_date" type="date" defaultValue={today} max={today} required/><Input label="Payment mode" name="payment_mode" maxLength={60}/><Input label="Reference" name="payment_reference" maxLength={160}/></>}
   <label className="block text-[12px] font-semibold text-[var(--text-secondary)]">Note<textarea name="note" maxLength={1000} className="field-control mt-1.5 min-h-24 w-full resize-y"/></label>
   {error&&<div className="alert-panel alert-panel--danger" role="alert">{error}</div>}
  </form>
 </Modal>
}
