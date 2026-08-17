"use client";

import { useRef, useState } from "react";
import { Download, FileSpreadsheet, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { Modal } from "@/components/ui/Modal";
import { MAX_IMPORT_BYTES, parseReceivablesTable, RECEIVABLE_HEADERS, type ImportRow, type InvalidImportRow } from "@/lib/receivables/import";

type Cell = string | number | boolean | Date | null | undefined;
interface PreviewRow extends ImportRow { classification: "NEW" | "EXACT_DUPLICATE" | "CONFLICTING_DUPLICATE" | "INVALID_EMPLOYEE" | "INVALID"; reason?: string; assigned_employee_name?: string }
interface Preview { rows: PreviewRow[]; counts: Record<string, number>; preview_hash: string }
interface ImportResult { created_count: number; duplicate_count: number }

export function firstMeaningfulWorksheet(XLSX: typeof import("xlsx"), workbook: import("xlsx").WorkBook): Cell[][] {
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const table = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true }) as Cell[][];
    if (table.some((row) => row.some((cell) => String(cell ?? "").trim() !== ""))) return table;
  }
  throw new Error("The workbook has no usable worksheet.");
}

export function ReceivablesImportModal({
  open,
  authFetch,
  onClose,
  onImported,
}: {
  open: boolean;
  authFetch: (url: string, init?: RequestInit) => Promise<Response>;
  onClose: () => void;
  onImported: (result: ImportResult) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [invalid, setInvalid] = useState<InvalidImportRow[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [operationId, setOperationId] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  function resetFile() {
    setFile(null); setRows([]); setInvalid([]); setPreview(null); setOperationId(""); setStatus("");
    if (inputRef.current) inputRef.current.value = "";
  }

  async function parseFile(selected: File) {
    resetFile();
    setFile(selected);
    setBusy(true);
    setStatus("Parsing spreadsheet…");
    try {
      if (selected.size > MAX_IMPORT_BYTES) throw new Error("Maximum file size is 10 MB.");
      if (!/\.(xlsx|xls|csv)$/i.test(selected.name)) throw new Error("Choose an XLSX, XLS, or CSV file.");
      const XLSX = await import("xlsx");
      let workbook: import("xlsx").WorkBook;
      try {
        workbook = XLSX.read(await selected.arrayBuffer(), { type: "array", cellDates: true, codepage: 65001 });
      } catch {
        throw new Error("The spreadsheet is corrupt, password-protected, or unsupported.");
      }
      const parsed = parseReceivablesTable(firstMeaningfulWorksheet(XLSX, workbook));
      const nextOperation = crypto.randomUUID();
      const response = await authFetch("/api/receivables/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "preview", operation_id: nextOperation, filename: selected.name, rows: parsed.rows }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Authoritative preview is unavailable.");
      setRows(parsed.rows); setInvalid(parsed.invalid); setPreview(result); setOperationId(nextOperation);
      setStatus("Authoritative preview complete. Nothing has been written.");
    } catch (cause) {
      setPreview(null);
      setStatus(cause instanceof Error ? cause.message : "The file could not be parsed.");
      if (inputRef.current) inputRef.current.value = "";
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!preview || !file || busy) return;
    setBusy(true); setStatus("Confirming atomic import…");
    try {
      const response = await authFetch("/api/receivables/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "confirm", operation_id: operationId, filename: file.name, preview_hash: preview.preview_hash, rows }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message ?? "Import was not confirmed.");
      await onImported(result);
      resetFile();
      onClose();
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : "Import was not confirmed.");
    } finally {
      setBusy(false);
    }
  }

  async function downloadTemplate() {
    const XLSX = await import("xlsx");
    const workbook = XLSX.utils.book_new();
    const template = XLSX.utils.aoa_to_sheet([[...RECEIVABLE_HEADERS]]);
    const instructions = XLSX.utils.aoa_to_sheet([
      ["Payment Collections Import Instructions"],
      ["Required", "Bill Reference, Distributor Name, Contact Person, Bill Amount, Bill Due Date, Payment Follow-up Date, Assigned Employee Email"],
      ["Money", "84500, 84,500, ₹84,500, or 84500.00"],
      ["Dates", "YYYY-MM-DD, DD/MM/YYYY, or DD-MM-YYYY"],
      ["Assignment", "Assigned Employee Email = exact CRM login email of an active operational employee."],
      ["Follow-up", "Must be today or a future India business date"],
      ["Duplicates", "Exact duplicates are skipped; conflicts are never overwritten"],
    ]);
    XLSX.utils.book_append_sheet(workbook, template, "Payment Collections Import");
    XLSX.utils.book_append_sheet(workbook, instructions, "Instructions");
    XLSX.writeFile(workbook, "Payment_Collections_Import_Template.xlsx");
  }

  const conflictCount = preview?.counts.conflict ?? 0;
  const invalidCount = (preview?.counts.invalid ?? 0) + invalid.length;
  const canConfirm = Boolean(preview && !invalidCount && !conflictCount && !busy);

  return (
    <Modal open={open} onClose={busy ? () => undefined : onClose} title="Import Spreadsheet" description="Preview and validate before one atomic database confirmation." size="lg">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-[var(--text-muted)]">XLSX, XLS, or CSV · maximum 10 MB · maximum 5,000 rows</p>
          <Button variant="outline" size="sm" icon={<Download size={15} />} onClick={() => void downloadTemplate()}>Download Import Template</Button>
        </div>
        <div
          aria-label="drag and drop spreadsheet upload"
          className={`rounded-[var(--radius-lg)] border-2 border-dashed p-6 text-center ${dragging ? "border-[var(--brand-500)] bg-[var(--brand-glow)]" : "border-[var(--border-default)]"}`}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => { event.preventDefault(); setDragging(false); const selected = event.dataTransfer.files[0]; if (selected) void parseFile(selected); }}
        >
          <Upload className="mx-auto text-[var(--text-muted)]" aria-hidden="true" />
          <p className="mt-2 font-semibold">Drag and drop a spreadsheet here</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">or browse from this device</p>
          <input ref={inputRef} className="sr-only" id="receivables-file" type="file" accept=".xlsx,.xls,.csv" onChange={(event) => { const selected = event.target.files?.[0]; if (selected) void parseFile(selected); }} />
          <Button className="mt-3" variant="outline" onClick={() => inputRef.current?.click()}>Browse file</Button>
        </div>
        {file && <div className="flex items-center justify-between gap-3 rounded-lg border p-3"><div className="min-w-0"><p className="flex items-center gap-2 truncate font-semibold"><FileSpreadsheet size={16} />{file.name}</p><p className="text-xs text-[var(--text-muted)]">{(file.size / 1024).toFixed(1)} KB</p></div><Button aria-label="Remove selected file" variant="ghost" icon={<X size={16} />} onClick={resetFile} disabled={busy}>Remove</Button></div>}
        {status && <div className="alert-panel alert-panel--info" role="status">{status}</div>}
        {preview && <>
          <div className="flex flex-wrap gap-2"><Chip variant="success">New: {preview.counts.new}</Chip><Chip>Duplicates skipped: {preview.counts.exactDuplicate}</Chip><Chip variant={conflictCount ? "danger" : "neutral"}>Conflicts: {conflictCount}</Chip><Chip variant={invalidCount ? "danger" : "neutral"}>Invalid: {invalidCount}</Chip></div>
          <div className="max-h-72 overflow-auto rounded-lg border"><table className="w-full min-w-[760px] text-left text-xs"><thead><tr>{["Row","Bill reference","Distributor","Amount","Due","Follow-up","Employee","Classification","Reason"].map((heading) => <th className="p-2" key={heading}>{heading}</th>)}</tr></thead><tbody>
            {invalid.map((row) => <tr className="border-t" key={`invalid-${row.rowNumber}`}><td className="p-2">{row.rowNumber}</td><td className="p-2" colSpan={6}>—</td><td className="p-2 font-semibold">INVALID</td><td className="p-2">{row.reason}</td></tr>)}
            {preview.rows.map((row) => <tr className="border-t" key={row.rowNumber}><td className="p-2">{row.rowNumber}</td><td className="p-2">{row.billReference}</td><td className="p-2">{row.distributorName}</td><td className="p-2">{row.billAmount}</td><td className="p-2">{row.billDueDate}</td><td className="p-2">{row.nextFollowUpDate}</td><td className="p-2"><span className="block font-medium">{row.assigned_employee_name ?? "Unresolved employee"}</span><span className="text-[var(--text-muted)]">{row.assignedEmployeeEmail}</span></td><td className="p-2 font-semibold">{row.classification}</td><td className="p-2">{row.reason ?? "—"}</td></tr>)}
          </tbody></table></div>
          {(conflictCount > 0 || invalidCount > 0) && <p className="text-xs font-medium text-[var(--status-danger)]">Correct conflicts and invalid rows, then choose the file again. Confirmation is disabled.</p>}
        </>}
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} disabled={busy}>Close</Button><Button onClick={() => void confirm()} disabled={!canConfirm} isLoading={busy}>Confirm Import</Button></div>
      </div>
    </Modal>
  );
}
