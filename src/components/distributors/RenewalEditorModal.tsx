"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import type { DistributorStatusRow } from "@/lib/distributors/types";

export function RenewalEditorModal({
  open,
  distributorId,
  onClose,
  onSave,
  authFetch,
}: {
  open: boolean;
  distributorId: string | null;
  onClose: () => void;
  onSave: () => void;
  authFetch: (url: string, init?: RequestInit) => Promise<Response>;
}) {
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [record, setRecord] = useState<DistributorStatusRow | null>(null);
  const [loading, setLoading] = useState(false);
  const operationId = useRef("");

  useEffect(() => {
    if (!open || !distributorId) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setRecord(null);
      setError("");
      operationId.current = "";
      void authFetch(`/api/distributors/${distributorId}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.message ?? "Failed to load distributor details.");
        return data;
      })
      .then((data) => {
        if (active && data.record) setRecord(data.record);
      })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Failed to load distributor details."); })
        .finally(() => { if (active) setLoading(false); });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [authFetch, distributorId, open]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || !record) return;
    const form = event.currentTarget;
    setError("");
    setSubmitting(true);
    try {
      const value = Object.fromEntries(new FormData(form).entries());
      const payload = {
        distributor_id: record.distributor_id,
        renewal_date: value.renewal_date || null,
        note: value.note || "",
        expected_version: record.version,
      };
      operationId.current ||= crypto.randomUUID();

      const response = await authFetch("/api/distributors/commands", {
        method: "POST",
        body: JSON.stringify({
          operation_id: operationId.current,
          operation_type: "renew",
          payload,
        }),
      });

      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? result.code);
      operationId.current = "";
      onSave();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Renewal failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={submitting ? () => undefined : onClose} title="Distributor Renewal" description="Set the next operational renewal date.">
      {loading ? (
        <p className="p-4 text-sm text-[var(--text-muted)]">Loading...</p>
      ) : record ? (
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={submit}>
          <Input name="distributor_name" label="Distributor Name" defaultValue={record.distributor_name} readOnly disabled />
          <Input type="date" name="renewal_date" label="Next Renewal Date" defaultValue={record.renewal_date ?? ""} required />
          <div className="sm:col-span-2">
            <Input name="note" label="Update Note (Optional)" maxLength={1000} />
          </div>
          {error && <div className="alert-panel alert-panel--danger sm:col-span-2" role="alert">{error}</div>}
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button variant="outline" type="button" onClick={onClose} disabled={submitting}>Cancel</Button>
            <Button type="submit" isLoading={submitting}>Confirm Renewal</Button>
          </div>
        </form>
      ) : (
        <p className="p-4 text-sm text-[var(--status-danger)]">{error || "Distributor not found."}</p>
      )}
    </Modal>
  );
}
