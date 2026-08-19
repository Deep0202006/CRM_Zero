"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { canonicalMoney } from "@/lib/receivables/domain";
import { getCurrentISTDate } from "@/lib/dateTime";

interface InitialDistributor { distributor_id:string; distributor_name:string; distributor_reference:string|null; assigned_to:string; assigned_employee_name?:string; billing_status?:"not_billed"|"billed" }

export function ReceivablesCreateModal({
  open,
  initialDistributor,
  onClose,
  onCreate,
}: {
  open: boolean;
  initialDistributor?: InitialDistributor;
  onClose: () => void;
  onCreate: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [distributors, setDistributors] = useState<InitialDistributor[]>([]);
  const [distributorSearch, setDistributorSearch] = useState("");
  useEffect(() => { if (!open||initialDistributor) return; const timer=window.setTimeout(async()=>{const {data}=await supabase.auth.getSession();if(!data.session?.access_token)return;const response=await fetch(`/api/distributors?page=1&pageSize=50&billing=billed&search=${encodeURIComponent(distributorSearch)}`,{headers:{Authorization:`Bearer ${data.session.access_token}`},cache:"no-store"});if(response.ok){const result=await response.json();setDistributors((result.rows??[]).filter((item:InitialDistributor)=>item.billing_status==="billed"))}},150); return()=>window.clearTimeout(timer); },[open,distributorSearch,initialDistributor]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const form = event.currentTarget;
    setError("");
    setSubmitting(true);
    try {
      const raw = Object.fromEntries(new FormData(form).entries());
      const distributor=initialDistributor??distributors.find(item=>item.distributor_id===String(raw.distributor_id));
      if(!distributor)throw new Error("Select a canonical Distributor Status record.");
      if(distributor.billing_status&&distributor.billing_status!=="billed")throw new Error("Only billed Distributors can create a Receivable.");
      await onCreate({
        ...raw,
        distributor_id: distributor.distributor_id,
        distributor_name: distributor.distributor_name,
        distributor_code: distributor.distributor_reference ?? "",
        assigned_to: distributor.assigned_to,
        receivable_id: crypto.randomUUID(),
        bill_amount: canonicalMoney(String(raw.bill_amount)),
      });
      form.reset();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The receivable was not confirmed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={submitting ? () => undefined : onClose} title="New Receivable" description="Create an authoritative bill for collection." size="lg">
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
        <label className="text-xs font-semibold text-[var(--text-secondary)] sm:col-span-2">Distributor Status <span className="text-[var(--status-danger)]">*</span>{initialDistributor?<><input type="hidden" name="distributor_id" value={initialDistributor.distributor_id}/><div className="field-control mt-1.5">{initialDistributor.distributor_name}{initialDistributor.distributor_reference?` · ${initialDistributor.distributor_reference}`:""}</div></>:<><Input aria-label="Search Distributor Status" value={distributorSearch} onChange={event=>setDistributorSearch(event.target.value)} placeholder="Search distributor or reference" /><select name="distributor_id" required className="field-control mt-1.5 w-full"><option value="">Select existing Distributor Status</option>{distributors.map(distributor=><option key={distributor.distributor_id} value={distributor.distributor_id}>{distributor.distributor_name}{distributor.distributor_reference?` · ${distributor.distributor_reference}`:""}</option>)}</select></>}</label>
        <Input name="bill_reference" label="Bill / Invoice Reference" required maxLength={120} />
        <Input name="contact_person" label="Contact Person" required maxLength={160} />
        <Input name="contact_phone" label="Contact Phone" maxLength={40} />
        <Input name="bill_amount" label="Bill Amount" description="Examples: 84500, 84,500, ₹84,500" required inputMode="decimal" />
        <Input name="bill_due_date" label="Bill Due Date" required type="date" />
        <Input name="next_follow_up_date" label="Payment Follow-up Date" required type="date" min={getCurrentISTDate()} />
        <div className="text-xs font-semibold text-[var(--text-secondary)]">Assigned Employee<div className="field-control mt-1.5">Defaults from the selected Distributor Status record.</div></div>
        <Input name="note" label="Notes" maxLength={1000} />
        {error && <div className="alert-panel alert-panel--danger sm:col-span-2" role="alert">{error}</div>}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button type="submit" isLoading={submitting}>Create Receivable</Button>
        </div>
      </form>
    </Modal>
  );
}
