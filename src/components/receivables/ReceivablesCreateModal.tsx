"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { canonicalMoney } from "@/lib/receivables/domain";
import { getCurrentISTDate } from "@/lib/dateTime";

interface ActiveUser { user_id: string; name: string; email: string }

export function ReceivablesCreateModal({
  open,
  users,
  onClose,
  onCreate,
}: {
  open: boolean;
  users: ActiveUser[];
  onClose: () => void;
  onCreate: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const form = event.currentTarget;
    setError("");
    setSubmitting(true);
    try {
      const raw = Object.fromEntries(new FormData(form).entries());
      await onCreate({
        ...raw,
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
        <Input data-autofocus name="distributor_name" label="Distributor Name" required maxLength={200} />
        <Input name="distributor_code" label="Distributor Code / Username" maxLength={80} />
        <Input name="bill_reference" label="Bill / Invoice Reference" required maxLength={120} />
        <Input name="contact_person" label="Contact Person" required maxLength={160} />
        <Input name="contact_phone" label="Contact Phone" maxLength={40} />
        <Input name="bill_amount" label="Bill Amount" description="Examples: 84500, 84,500, ₹84,500" required inputMode="decimal" />
        <Input name="bill_due_date" label="Bill Due Date" required type="date" />
        <Input name="next_follow_up_date" label="Payment Follow-up Date" required type="date" min={getCurrentISTDate()} />
        <label className="text-xs font-semibold text-[var(--text-secondary)]">
          Assigned Employee <span className="text-[var(--status-danger)]">*</span>
          <select name="assigned_to" required className="field-control mt-1.5 w-full">
            <option value="">Select active employee</option>
            {users.map((user) => <option value={user.user_id} key={user.user_id}>{user.name} · {user.email}</option>)}
          </select>
        </label>
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
