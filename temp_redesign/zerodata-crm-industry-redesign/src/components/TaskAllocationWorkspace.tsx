"use client";

import { useMemo, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import {
  getCityTaskCounts,
  normalizeCityKey,
  parseTaskAllocationTable,
  type CityAssignmentMap,
  type ParsedTaskAllocationFile,
} from "@/lib/taskAllocationExcel";
import { FileSpreadsheet, UploadCloud, AlertCircle, CheckCircle2, MapPin, Users, Send, FileCheck2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const isActive = (value: unknown) => String(value) === "1" || String(value) === "true";

export function TaskAllocationWorkspace() {
  const { allUsers } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedTaskAllocationFile | null>(null);
  const [fileHash, setFileHash] = useState("");
  const [assignments, setAssignments] = useState<CityAssignmentMap>({});
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [selectedUser, setSelectedUser] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [message, setMessage] = useState({ text: "", type: "info" as "info" | "success" | "error" });

  const users = useMemo(() => allUsers.filter((user) => isActive(user.is_active)), [allUsers]);
  const cityCounts = useMemo(() => (parsed ? getCityTaskCounts(parsed.rows) : {}), [parsed]);
  const unmapped = useMemo(() => parsed?.cities.filter((city) => !assignments[normalizeCityKey(city)]) ?? [], [parsed, assignments]);
  const totals = useMemo(
    () => Object.entries(assignments).reduce<Record<string, number>>(
      (result, [city, userId]) => ({ ...result, [userId]: (result[userId] ?? 0) + (cityCounts[city] ?? 0) }),
      {}
    ),
    [assignments, cityCounts]
  );

  const resetUpload = () => {
    setFile(null);
    setParsed(null);
    setAssignments({});
    setSelectedCities([]);
    setSelectedUser("");
    setFileHash("");
    setMessage({ text: "", type: "info" });
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  async function parseFile() {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES || !/\.(xlsx|xls|csv)$/i.test(file.name)) {
      setMessage({ text: "Use an XLSX, XLS, or CSV file up to 10 MB.", type: "error" });
      return;
    }

    setBusy(true);
    setMessage({ text: "Validating spreadsheet structure…", type: "info" });
    try {
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", buffer);
      const workbook = XLSX.read(buffer, { type: "array", raw: false });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const result = parseTaskAllocationTable(
        XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, { header: 1, defval: "", raw: false })
      );
      if (!result.rows.length) throw new Error("No valid task rows were found in the first sheet.");
      setFileHash(Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""));
      setParsed(result);
      setAssignments({});
      setSelectedCities([]);
      setMessage({
        text: `Validated ${result.rows.length} tasks across ${result.cities.length} cities. ${result.rejectedRows.length} rows need correction.`,
        type: "success",
      });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Unable to parse the selected file.", type: "error" });
    } finally {
      setBusy(false);
    }
  }

  function assignSelected() {
    if (!selectedUser || !selectedCities.length) return;
    setAssignments((current) => ({
      ...current,
      ...Object.fromEntries(selectedCities.map((city) => [normalizeCityKey(city), selectedUser])),
    }));
    setSelectedCities([]);
  }

  async function allocate() {
    if (!parsed || unmapped.length) return;
    setConfirmOpen(false);
    setBusy(true);
    setMessage({ text: "Allocating the validated batch…", type: "info" });
    try {
      const { data, error } = await supabase.rpc("allocate_city_task_batch", {
        p_filename: file?.name ?? "upload.xlsx",
        p_file_hash: fileHash,
        p_rows: parsed.rows,
        p_city_assignments: assignments,
      });
      if (error) {
        const errorMessage = error.code === "23505"
          ? "This spreadsheet has already been processed."
          : error.code === "42501"
            ? "Your account is not authorised to allocate this batch."
            : error.message;
        throw new Error(errorMessage);
      }
      const response = data as { allocatedCount?: number; batchId?: string } | null;
      setMessage({
        text: `Allocated ${response?.allocatedCount ?? parsed.rows.length} tasks${response?.batchId ? ` in batch ${response.batchId}` : ""}.`,
        type: "success",
      });
      setFile(null);
      setParsed(null);
      setAssignments({});
      setSelectedCities([]);
      setSelectedUser("");
      setFileHash("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Allocation failed.", type: "error" });
    } finally {
      setBusy(false);
    }
  }

  const alertClass = message.type === "error"
    ? "alert-panel alert-panel--danger"
    : message.type === "success"
      ? "alert-panel alert-panel--success"
      : "alert-panel alert-panel--info";

  return (
    <div className="page-stack">
      <section className="surface-panel overflow-hidden" aria-labelledby="spreadsheet-upload-title">
        <div className="flex flex-col gap-4 border-b border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--brand-100)] text-[var(--brand-800)]">
              <FileSpreadsheet size={19} />
            </span>
            <div>
              <h2 id="spreadsheet-upload-title" className="section-title">Spreadsheet intake</h2>
              <p className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">Validate the first worksheet before assigning cities to active staff.</p>
            </div>
          </div>
          {file && (
            <Button type="button" variant="ghost" size="sm" onClick={resetUpload} icon={<X size={14} />}>
              Clear file
            </Button>
          )}
        </div>

        <div className="p-5 sm:p-6">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-stretch">
            <label className="group relative flex min-h-[150px] cursor-pointer items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-[var(--border-strong)] bg-[var(--surface-secondary)] p-6 text-center transition hover:border-[var(--brand-500)] hover:bg-[var(--brand-50)] focus-within:ring-4 focus-within:ring-[var(--brand-glow)]">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setParsed(null);
                  setMessage({ text: "", type: "info" });
                }}
              />
              <div className="pointer-events-none">
                <span className="mx-auto grid h-11 w-11 place-items-center rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--surface-primary)] text-[var(--brand-700)] shadow-[var(--shadow-raised)]">
                  {file ? <FileCheck2 size={20} /> : <UploadCloud size={20} />}
                </span>
                <p className="mt-3 text-[13px] font-semibold text-[var(--text-primary)]">{file ? file.name : "Choose a spreadsheet"}</p>
                <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                  {file ? `${(file.size / 1024 / 1024).toFixed(2)} MB selected` : "XLSX, XLS, or CSV · maximum 10 MB"}
                </p>
              </div>
            </label>

            <Button type="button" className="min-w-[180px] self-stretch lg:min-h-[150px]" onClick={parseFile} disabled={!file} isLoading={busy && !parsed} icon={<FileSpreadsheet size={16} />}>
              Validate file
            </Button>
          </div>

          {message.text && (
            <div className={`${alertClass} mt-4`} role={message.type === "error" ? "alert" : "status"}>
              {message.type === "success" ? <CheckCircle2 size={17} className="mt-0.5 shrink-0" /> : <AlertCircle size={17} className="mt-0.5 shrink-0" />}
              <span>{message.text}</span>
            </div>
          )}
        </div>
      </section>

      {parsed && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <section className="surface-panel min-w-0 overflow-hidden" aria-labelledby="city-mapping-title">
            <div className="flex flex-col gap-4 border-b border-[var(--border-subtle)] p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="section-kicker">Allocation map</p>
                <h2 id="city-mapping-title" className="mt-1 section-title">Assign every city to an owner</h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Chip variant="neutral" size="sm">{parsed.cities.length} cities</Chip>
                <Chip variant={unmapped.length ? "warning" : "success"} size="sm">{unmapped.length ? `${unmapped.length} unmapped` : "Ready to allocate"}</Chip>
              </div>
            </div>

            <div className="surface-toolbar m-4 sm:m-5">
              <select aria-label="Team member for selected cities" value={selectedUser} onChange={(event) => setSelectedUser(event.target.value)} className="field-control min-w-0 flex-1">
                <option value="">Select assignee for checked cities</option>
                {users.map((user) => <option key={user.user_id} value={user.user_id}>{user.name}</option>)}
              </select>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={assignSelected} disabled={!selectedUser || !selectedCities.length}>Assign selected</Button>
                <Button type="button" variant="secondary" size="sm" onClick={() => setSelectedCities(parsed.cities)}>Select all</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedCities([])}>Clear</Button>
              </div>
            </div>

            <div className="max-h-[560px] overflow-auto border-t border-[var(--border-subtle)]">
              <table className="w-full min-w-[660px] border-collapse">
                <thead className="sticky top-0 z-[var(--z-sticky)] bg-[var(--surface-secondary)] shadow-[0_1px_0_var(--border-subtle)]">
                  <tr>
                    <th className="h-11 px-5 text-left text-[10px] font-bold uppercase tracking-[0.07em] text-[var(--text-muted)]">City or region</th>
                    <th className="h-11 px-4 text-right text-[10px] font-bold uppercase tracking-[0.07em] text-[var(--text-muted)]">Tasks</th>
                    <th className="h-11 px-5 text-left text-[10px] font-bold uppercase tracking-[0.07em] text-[var(--text-muted)]">Assigned owner</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.cities.map((city) => {
                    const key = normalizeCityKey(city);
                    const mapped = Boolean(assignments[key]);
                    const selected = selectedCities.includes(city);
                    return (
                      <tr key={city} className={`${selected ? "bg-[var(--surface-selected)]" : !mapped ? "bg-[var(--status-warning-soft)]/35" : ""} border-t border-[var(--border-subtle)] transition hover:bg-[var(--surface-hover)]`}>
                        <td className="px-5 py-3">
                          <label className="flex cursor-pointer items-center gap-3">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-[var(--border-strong)] accent-[var(--brand-600)]"
                              checked={selected}
                              onChange={() => setSelectedCities((current) => current.includes(city) ? current.filter((item) => item !== city) : [...current, city])}
                            />
                            <span className="text-[13px] font-semibold text-[var(--text-primary)]">{city}</span>
                          </label>
                        </td>
                        <td className="px-4 py-3 text-right text-[12px] font-semibold tabular-nums text-[var(--text-secondary)]">{cityCounts[key]}</td>
                        <td className="px-5 py-2.5">
                          <select
                            aria-label={`Assignee for ${city}`}
                            value={assignments[key] ?? ""}
                            onChange={(event) => setAssignments((current) => ({ ...current, [key]: event.target.value }))}
                            className={`field-control min-h-9 py-1.5 text-[12px] ${mapped ? "" : "border-[var(--status-warning)] bg-[var(--status-warning-soft)] text-[var(--status-warning)]"}`}
                          >
                            <option value="">Unmapped</option>
                            {users.map((user) => <option key={user.user_id} value={user.user_id}>{user.name}</option>)}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <aside className="surface-panel h-fit overflow-hidden xl:sticky xl:top-4" aria-labelledby="assignment-summary-title">
            <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-5">
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 place-items-center rounded-[var(--radius-md)] bg-[var(--status-success-soft)] text-[var(--status-success)]"><Users size={17} /></span>
                <div>
                  <p className="section-kicker">Batch summary</p>
                  <h2 id="assignment-summary-title" className="mt-0.5 section-title">Workload by owner</h2>
                </div>
              </div>
            </div>

            <div className="space-y-4 p-5">
              {Object.keys(totals).length === 0 ? (
                <EmptyState icon={<MapPin size={20} />} title="No cities assigned" description="Select cities, choose an assignee, and apply the mapping." compact />
              ) : (
                <div className="space-y-2">
                  {Object.entries(totals).sort((a, b) => b[1] - a[1]).map(([id, count]) => {
                    const userName = users.find((user) => user.user_id === id)?.name ?? "Unknown user";
                    const percentage = parsed.rows.length ? Math.min(100, Math.round((count / parsed.rows.length) * 100)) : 0;
                    return (
                      <div key={id} className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate text-[12px] font-semibold text-[var(--text-primary)]">{userName}</span>
                          <span className="text-[12px] font-semibold tabular-nums text-[var(--brand-700)]">{count}</span>
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-tertiary)]">
                          <div className="h-full rounded-full bg-[var(--brand-500)]" style={{ width: `${percentage}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {unmapped.length > 0 && (
                <div className="alert-panel alert-panel--warning">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <span>{unmapped.length} {unmapped.length === 1 ? "city is" : "cities are"} still unmapped. Every city requires an owner before submission.</span>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 rounded-[var(--radius-md)] bg-[var(--surface-secondary)] p-3">
                <div><p className="text-xl font-semibold tabular-nums">{parsed.rows.length}</p><p className="text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--text-muted)]">Valid tasks</p></div>
                <div><p className="text-xl font-semibold tabular-nums">{parsed.rejectedRows.length}</p><p className="text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--text-muted)]">Rejected rows</p></div>
              </div>

              <Button type="button" className="w-full" onClick={() => setConfirmOpen(true)} disabled={!Object.keys(assignments).length || unmapped.length > 0 || busy} icon={<Send size={16} />}>
                Review and allocate
              </Button>
            </div>
          </aside>
        </div>
      )}

      <Modal
        open={confirmOpen}
        onClose={() => !busy && setConfirmOpen(false)}
        title="Confirm task allocation"
        description="This creates one atomic allocation batch using the validated spreadsheet and current city-owner map."
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={busy}>Cancel</Button>
            <Button onClick={allocate} isLoading={busy} icon={<Send size={15} />}>Allocate {parsed?.rows.length ?? 0} tasks</Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-[var(--radius-md)] bg-[var(--surface-secondary)] p-3">
              <p className="text-[22px] font-semibold tabular-nums text-[var(--text-primary)]">{parsed?.rows.length ?? 0}</p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--text-muted)]">Validated tasks</p>
            </div>
            <div className="rounded-[var(--radius-md)] bg-[var(--surface-secondary)] p-3">
              <p className="text-[22px] font-semibold tabular-nums text-[var(--text-primary)]">{parsed?.cities.length ?? 0}</p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.06em] text-[var(--text-muted)]">Mapped cities</p>
            </div>
          </div>
          <div className="alert-panel alert-panel--info">
            <FileCheck2 size={16} className="mt-0.5 shrink-0" />
            <span>File: {file?.name || "Validated spreadsheet"}. Duplicate batches remain protected by the server.</span>
          </div>
        </div>
      </Modal>
    </div>
  );
}
