"use client";

import { useRef, useState } from "react";
import { Download, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Modal } from "@/components/ui/Modal";
import { DISTRIBUTOR_IMPORT_HEADERS, MAX_DISTRIBUTOR_IMPORT_BYTES, parseDistributorTable, type DistributorImportRow } from "@/lib/distributors/import";
import { firstMeaningfulWorksheet } from "@/components/receivables/ReceivablesImportModal";

interface Preview { rows: Array<DistributorImportRow & { classification: string; reason?: string; assigned_employee_name?: string }>; counts: Record<string, number>; preview_hash: string }

export function DistributorImportModal({ open, authFetch, onClose, onImported }: { open: boolean; authFetch: (url: string, init?: RequestInit) => Promise<Response>; onClose: () => void; onImported: () => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const parseGeneration = useRef(0);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<DistributorImportRow[]>([]);
  const [invalid, setInvalid] = useState<Array<{ rowNumber: number; reason: string }>>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [operationId, setOperationId] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  function reset() { parseGeneration.current += 1; setFile(null); setRows([]); setInvalid([]); setPreview(null); setOperationId(""); setStatus(""); if (input.current) input.current.value = ""; }
  async function parse(fileValue: File) {
    reset(); const generation = parseGeneration.current; setFile(fileValue); setBusy(true);
    try {
      if (fileValue.size > MAX_DISTRIBUTOR_IMPORT_BYTES) throw new Error("Maximum file size is 10 MB.");
      if (!/\.(xlsx|xls|csv)$/i.test(fileValue.name)) throw new Error("Choose an XLSX, XLS, or CSV file.");
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await fileValue.arrayBuffer(), { type: "array", cellDates: true, codepage: 65001 });
      const parsed = parseDistributorTable(firstMeaningfulWorksheet(XLSX, workbook));
      const operation = crypto.randomUUID();
      const response = await authFetch("/api/distributors/import", { method: "POST", body: JSON.stringify({ mode: "preview", operation_id: operation, filename: fileValue.name, rows: parsed.rows }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Preview unavailable.");
      if (generation !== parseGeneration.current) return;
      setRows(parsed.rows); setInvalid(parsed.invalid); setOperationId(operation); setPreview(result); setStatus("Authoritative preview complete. Nothing has been written.");
    } catch (cause) { if (generation === parseGeneration.current) { setStatus(cause instanceof Error ? cause.message : "File could not be parsed."); if (input.current) input.current.value = ""; } } finally { if (generation === parseGeneration.current) setBusy(false); }
  }
  async function confirm() {
    if (!preview || !file) return; setBusy(true);
    try {
      const response = await authFetch("/api/distributors/import", { method: "POST", body: JSON.stringify({ mode: "confirm", operation_id: operationId, filename: file.name, preview_hash: preview.preview_hash, rows }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Import failed.");
      await onImported(); reset(); onClose();
    } catch (cause) { setStatus(cause instanceof Error ? cause.message : "Import failed."); } finally { setBusy(false); }
  }
  function template() {
    void import("xlsx").then((XLSX) => {
      const book = XLSX.utils.book_new();
      const sheet = XLSX.utils.aoa_to_sheet([[...DISTRIBUTOR_IMPORT_HEADERS], ["Example Distributor", "employee@example.com", "pending", "", "pending", "", "pending", "", "not_applicable", "not_billed", "", "", "2026-12-31", "DIST-001"]]);
      XLSX.utils.book_append_sheet(book, sheet, "Distributor Status");
      XLSX.writeFile(book, "Distributor_Status_Import_Template.xlsx");
    });
  }
  const blocked = invalid.length > 0 || Boolean((preview?.counts.AMBIGUOUS ?? 0) + (preview?.counts.INVALID_EMPLOYEE ?? 0));
  return <Modal open={open} onClose={() => { reset(); onClose(); }} title="Import Distributor Status" description="Preview is authoritative; commit revalidates and is atomic."><div className="space-y-4"><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={template} icon={<Download size={15} />}>Download Template</Button><label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm"><Upload size={15} />Choose XLSX, XLS, or CSV<input ref={input} className="sr-only" type="file" accept=".xlsx,.xls,.csv" onChange={(event) => { const next = event.target.files?.[0]; if (next) void parse(next); }} /></label>{file && <Button variant="ghost" onClick={reset} icon={<X size={15} />}>Remove</Button>}</div>{status && <p className="text-sm">{status}</p>}{preview && <><div className="flex flex-wrap gap-2">{Object.entries(preview.counts).map(([key, value]) => <Chip key={key}>{key}: {value}</Chip>)}{invalid.length > 0 && <Chip variant="danger">LOCAL INVALID: {invalid.length}</Chip>}</div><div className="max-h-80 overflow-auto"><table className="w-full min-w-[700px] text-left text-xs"><thead><tr>{["Row", "Distributor", "Employee", "Classification", "Error"].map((value) => <th className="p-2" key={value}>{value}</th>)}</tr></thead><tbody>{preview.rows.map((row) => <tr className="border-t" key={row.rowNumber}><td className="p-2">{row.rowNumber}</td><td className="p-2">{row.distributorName}</td><td className="p-2">{row.assigned_employee_name ?? row.assignedEmployeeEmail}</td><td className="p-2 font-semibold">{row.classification}</td><td className="p-2">{row.reason ?? "—"}</td></tr>)}{invalid.map((row) => <tr className="border-t" key={`invalid-${row.rowNumber}`}><td className="p-2">{row.rowNumber}</td><td colSpan={3} className="p-2">Invalid local row</td><td className="p-2">{row.reason}</td></tr>)}</tbody></table></div><div className="flex justify-end"><Button disabled={blocked || busy} isLoading={busy} onClick={() => void confirm()}>Confirm Atomic Import</Button></div></>}</div></Modal>;
}
