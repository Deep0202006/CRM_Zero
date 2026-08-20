"use client";

import { useRef, useState } from "react";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Modal } from "@/components/ui/Modal";
import { MASTER_WORKBOOK_FILENAME, MAX_MASTER_WORKBOOK_BYTES } from "@/lib/distributorMaster/workbook";

type SheetKey = "distributors" | "receivables" | "payments";
type PreviewRow = Record<string, unknown> & {
  rowNumber: number;
  classification: string;
  action: "CREATE" | "UPDATE" | "CONFIRM" | "SKIP" | "BLOCK";
  reason?: string;
  before: unknown;
  after: unknown;
};

interface MasterPreview {
  rows: Record<SheetKey, PreviewRow[]>;
  counts: Record<SheetKey, Record<string, number>> & { total: number; blocking: number };
  blocking: boolean;
  resolvedPlanHash: string;
}

export interface MasterImportConfirmationResult {
  success: boolean;
  replayed?: boolean;
  distributors?: Record<string, unknown>;
  receivables?: Record<string, unknown>;
  payments?: Record<string, unknown>;
}

interface Props {
  open: boolean;
  authFetch: (url: string, init?: RequestInit) => Promise<Response>;
  onClose: () => void;
  onImported: (result: MasterImportConfirmationResult) => Promise<void>;
}

const SHEETS: Array<{ key: SheetKey; label: string }> = [
  { key: "distributors", label: "Distributors" },
  { key: "receivables", label: "Receivables" },
  { key: "payments", label: "Payments" },
];

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(displayValue).join(", ");
  return Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== null && entry !== undefined && entry !== "")
    .map(([key, entry]) => `${key.replaceAll("_", " ")}: ${displayValue(entry)}`)
    .join(" · ") || "—";
}

function count(result: Record<string, unknown> | undefined, ...keys: string[]): number {
  for (const key of keys) {
    const value = Number(result?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function errorMessage(value: unknown): string {
  if (value && typeof value === "object" && "message" in value && typeof value.message === "string") return value.message;
  return "The master workbook request failed.";
}

function actionCount(preview: MasterPreview, action: PreviewRow["action"]): number {
  return SHEETS.reduce((total, { key }) => total + preview.rows[key].filter((row) => row.action === action).length, 0);
}

function actionLabel(action: PreviewRow["action"]): string {
  return ({ CREATE: "Create", UPDATE: "Update", CONFIRM: "Confirm Payment", SKIP: "Skip", BLOCK: "Block" } as const)[action];
}

function objectValue(value: unknown, key: string): unknown {
  return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}

function projectedPaymentState(value: unknown): string {
  return String(objectValue(value, "paymentState") ?? objectValue(value, "payment_state") ?? "");
}

function previewSummary(preview: MasterPreview) {
  const finalPaymentByReceivable = new Map<string, PreviewRow>();
  for (const payment of preview.rows.payments) {
    const id = String(payment.resolvedReceivableId ?? objectValue(payment.after, "receivable_id") ?? "");
    if (id) finalPaymentByReceivable.set(id, payment);
  }
  let paid = 0, partial = 0, unpaid = 0;
  for (const receivable of preview.rows.receivables.filter((row) => row.action === "CREATE")) {
    const id = String(receivable.resolvedReceivableId ?? objectValue(receivable.after, "receivable_id") ?? "");
    const state = projectedPaymentState(finalPaymentByReceivable.get(id)?.after);
    if (/^paid$/i.test(state)) paid += 1;
    else if (/partial/i.test(state)) partial += 1;
    else unpaid += 1;
  }
  const blocked = SHEETS.flatMap(({ key }) => preview.rows[key]).filter((row) => row.action === "BLOCK");
  const conflicts = blocked.filter((row) => /conflict|ambiguous|duplicate/i.test(`${row.classification} ${row.reason ?? ""}`)).length;
  return {
    newDistributors: preview.rows.distributors.filter((row) => row.action === "CREATE").length,
    distributorUpdates: preview.rows.distributors.filter((row) => row.action === "UPDATE").length,
    noChange: actionCount(preview, "SKIP"),
    newReceivables: preview.rows.receivables.filter((row) => row.action === "CREATE").length,
    newPayments: preview.rows.payments.filter((row) => row.action === "CONFIRM").length,
    paid, partial, unpaid, conflicts, invalid: blocked.length - conflicts,
  };
}

export function DistributorMasterImportModal({ open, authFetch, onClose, onImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const requestGeneration = useRef(0);
  const [file, setFile] = useState<File | null>(null);
  const [operationId, setOperationId] = useState("");
  const [preview, setPreview] = useState<MasterPreview | null>(null);
  const [result, setResult] = useState<MasterImportConfirmationResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function reset() {
    requestGeneration.current += 1;
    setFile(null);
    setOperationId("");
    setPreview(null);
    setResult(null);
    setError("");
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  function close() {
    if (busy) return;
    reset();
    onClose();
  }

  async function downloadTemplate() {
    setError("");
    try {
      const [{ createMasterWorkbook }, XLSX] = await Promise.all([
        import("@/lib/distributorMaster/workbook"),
        import("xlsx"),
      ]);
      XLSX.writeFile(createMasterWorkbook(), MASTER_WORKBOOK_FILENAME);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The workbook template could not be created.");
    }
  }

  async function request(mode: "preview" | "confirm") {
    if (!file || !operationId) return;
    const generation = ++requestGeneration.current;
    setBusy(true);
    setError("");
    const form = new FormData();
    form.set("mode", mode);
    form.set("operation_id", operationId);
    form.set("file", file);
    if (mode === "confirm" && preview) form.set("resolved_plan_hash", preview.resolvedPlanHash);
    try {
      const response = await authFetch("/api/distributors/master-import", { method: "POST", body: form });
      const body: unknown = await response.json();
      if (generation !== requestGeneration.current) return;
      if (!response.ok) {
        if (response.status === 409 && body && typeof body === "object" && "preview" in body) {
          setPreview((body as { preview: MasterPreview }).preview);
        }
        throw body;
      }
      if (mode === "preview") setPreview(body as MasterPreview);
      else {
        const confirmation = body as MasterImportConfirmationResult;
        setResult(confirmation);
        await onImported(confirmation);
      }
    } catch (cause) {
      if (generation === requestGeneration.current) setError(errorMessage(cause));
    } finally {
      if (generation === requestGeneration.current) setBusy(false);
    }
  }

  function selectFile(selected: File | null) {
    requestGeneration.current += 1;
    setPreview(null);
    setResult(null);
    setError("");
    if (!selected) {
      setFile(null);
      setOperationId("");
      return;
    }
    if (!selected.name.toLocaleLowerCase("en-IN").endsWith(".xlsx")) {
      setFile(null);
      setOperationId("");
      setError("Choose one .xlsx master workbook.");
      return;
    }
    if (selected.name !== MASTER_WORKBOOK_FILENAME) {
      setFile(null);
      setOperationId("");
      setError(`Choose the exact ${MASTER_WORKBOOK_FILENAME} template.`);
      return;
    }
    if (selected.size > MAX_MASTER_WORKBOOK_BYTES) {
      setFile(null);
      setOperationId("");
      setError("Maximum workbook size is 10 MB.");
      return;
    }
    setFile(selected);
    setOperationId(crypto.randomUUID());
  }

  const footer = result ? (
    <Button onClick={close}>Done</Button>
  ) : (
    <>
      <Button variant="outline" onClick={close} disabled={busy}>Cancel</Button>
      {!preview ? (
        <Button onClick={() => void request("preview")} disabled={!file} isLoading={busy}>Preview workbook</Button>
      ) : (
        <>
          <Button variant="outline" onClick={() => void request("preview")} disabled={busy}>Refresh preview</Button>
          <Button onClick={() => void request("confirm")} disabled={preview.blocking} isLoading={busy}>Confirm {actionCount(preview, "CREATE") + actionCount(preview, "UPDATE") + actionCount(preview, "CONFIRM")} Safe Changes</Button>
        </>
      )}
    </>
  );

  return (
    <Modal
      open={open}
      onClose={close}
      title="Import / Update Master Workbook"
      description="Preview every row before one atomic confirmation. No business records are written during preview."
      size="lg"
      footer={footer}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--border-subtle)] p-4">
          <div>
            <p className="text-sm font-semibold">{MASTER_WORKBOOK_FILENAME}</p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">Download and keep the exact filename, XLSX format, sheet names, and columns.</p>
          </div>
          <Button variant="outline" icon={<Download size={15} />} onClick={() => void downloadTemplate()}>Download exact template</Button>
        </div>

        {!result && (
          <div>
            <input
              ref={inputRef}
              className="sr-only"
              type="file"
              accept=".xlsx"
              onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
            />
            <Button variant="outline" icon={<Upload size={15} />} onClick={() => inputRef.current?.click()} disabled={busy}>
              Choose exact XLSX workbook
            </Button>
            {file && (
              <div className="mt-3 flex items-center gap-3 rounded-lg bg-[var(--surface-secondary)] p-3 text-sm">
                <FileSpreadsheet size={18} className="shrink-0 text-[var(--brand-600)]" />
                <span className="min-w-0 flex-1 truncate font-semibold">{file.name}</span>
                <span className="text-xs text-[var(--text-muted)]">{(file.size / 1024).toFixed(1)} KB</span>
              </div>
            )}
          </div>
        )}

        {error && <div className="alert-panel alert-panel--danger" role="alert">{error}</div>}

        {!result && <div className="alert-panel alert-panel--warning" role="note">Confirmation is atomic. Either all planned changes commit or none do.</div>}

        {preview && !result && (
          <section aria-label="Master workbook preview" className="space-y-4">
            <div className={`alert-panel ${preview.blocking ? "alert-panel--danger" : "alert-panel--info"}`} role="status">
              {preview.blocking
                ? `${preview.counts.blocking} blocking row(s) must be corrected. Confirmation is disabled.`
                : `${preview.counts.total} row(s) resolved. Review Before and After, then confirm the atomic import.`}
            </div>
            <div className="flex flex-wrap gap-2">{(() => { const summary = previewSummary(preview); return <>
              <Chip>New Distributors: {summary.newDistributors}</Chip><Chip>Distributor Updates: {summary.distributorUpdates}</Chip><Chip>No Change: {summary.noChange}</Chip>
              <Chip>New Receivables: {summary.newReceivables}</Chip><Chip>New Payments: {summary.newPayments}</Chip>
              <Chip>Will Become Paid: {summary.paid}</Chip><Chip>Will Become Partially Paid: {summary.partial}</Chip><Chip>Will Remain Unpaid: {summary.unpaid}</Chip>
              <Chip variant={summary.conflicts ? "danger" : "success"}>Conflicts: {summary.conflicts}</Chip><Chip variant={summary.invalid ? "danger" : "success"}>Invalid Rows: {summary.invalid}</Chip>
            </>; })()}</div>
            <div className="max-h-96 overflow-auto rounded-lg border border-[var(--border-subtle)]">
              <table className="w-full min-w-[1000px] text-left text-xs">
                <thead><tr>{["Sheet", "Row", "Distributor", "Bill", "Current State", "Action", "Result State", "Reason"].map((heading) => <th className="p-2" key={heading}>{heading}</th>)}</tr></thead>
                <tbody>{SHEETS.flatMap(({ key, label }) => preview.rows[key].map((row) => (
                  <tr className={`border-t border-[var(--border-subtle)] align-top ${row.action === "BLOCK" ? "bg-[var(--status-danger-soft)]" : ""}`} key={`${key}-${row.rowNumber}`}>
                    <td className="p-2">{label}</td><td className="p-2 tabular-nums">{row.rowNumber}</td>
                    <td className="p-2 font-semibold">{displayValue(row.distributorName ?? row.distributorReference)}</td><td className="p-2">{displayValue(row.billReference)}</td>
                    <td className="max-w-64 p-2 text-[var(--text-muted)]">{displayValue(row.before)}</td>
                    <td className="p-2"><Chip size="sm" variant={row.action === "BLOCK" ? "danger" : row.action === "SKIP" ? "neutral" : "success"}>{actionLabel(row.action)}</Chip></td>
                    <td className="max-w-64 p-2">{displayValue(row.after)}</td><td className="max-w-52 p-2 text-[var(--status-danger)]">{row.reason ?? "—"}</td>
                  </tr>
                )))}</tbody>
              </table>
            </div>
          </section>
        )}

        {result && (
          <section aria-label="Master import completion summary" className="space-y-4">
            <div className="alert-panel alert-panel--info" role="status">
              {result.replayed ? "This workbook confirmation was already applied; the same authoritative result was returned." : "Master workbook imported successfully."}
            </div>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <Completion label="Distributors created" value={count(result.distributors, "created_count", "created")} />
              <Completion label="Distributors updated" value={count(result.distributors, "updated_count", "updated")} />
              <Completion label="Renewals updated" value={preview?.rows.distributors.filter((row) => row.action === "UPDATE" && objectValue(row.before, "renewal_date") !== objectValue(row.after, "renewal_date")).length ?? 0} />
              <Completion label="Receivables created" value={count(result.receivables, "created_count", "created")} />
              <Completion label="Payments recorded" value={count(result.payments, "created_count", "confirmed", "created")} />
              <Completion label="Exact duplicates skipped" value={count(result.distributors, "duplicate_count", "skipped") + count(result.receivables, "duplicate_count", "skipped") + count(result.payments, "duplicate_count", "skipped")} />
              <Completion label="Now Paid" value={preview ? previewSummary(preview).paid : 0} /><Completion label="Now Partially Paid" value={preview ? previewSummary(preview).partial : 0} /><Completion label="Still Unpaid" value={preview ? previewSummary(preview).unpaid : 0} />
            </dl>
          </section>
        )}
      </div>
    </Modal>
  );
}

function Completion({ label, value }: { label: string; value: number }) {
  return <div className="flex justify-between rounded-lg border border-[var(--border-subtle)] p-3"><dt>{label}</dt><dd className="font-semibold tabular-nums">{value}</dd></div>;
}
