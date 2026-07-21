"use client";

import { useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import { getCityTaskCounts, normalizeCityKey, parseTaskAllocationTable, type CityAssignmentMap, type ParsedTaskAllocationFile } from "@/lib/taskAllocationExcel";

const MAX_FILE_BYTES = 3 * 1024 * 1024;
const isActive = (value: unknown) => String(value) === "1" || String(value) === "true";

export function TaskAllocationWorkspace() {
  const { allUsers } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedTaskAllocationFile | null>(null);
  const [fileHash, setFileHash] = useState("");
  const [assignments, setAssignments] = useState<CityAssignmentMap>({});
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [selectedUser, setSelectedUser] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const users = useMemo(() => allUsers.filter((user) => isActive(user.is_active)), [allUsers]);
  const cityCounts = useMemo(() => parsed ? getCityTaskCounts(parsed.rows) : {}, [parsed]);
  const unmapped = useMemo(() => parsed?.cities.filter((city) => !assignments[normalizeCityKey(city)]) ?? [], [parsed, assignments]);
  const totals = useMemo(() => Object.entries(assignments).reduce<Record<string, number>>((result, [city, userId]) => ({ ...result, [userId]: (result[userId] ?? 0) + (cityCounts[city] ?? 0) }), {}), [assignments, cityCounts]);

  async function parseFile() {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES || !/\.(xlsx|xls|csv)$/i.test(file.name)) { setMessage("Use an XLSX, XLS, or CSV file up to 3 MB."); return; }
    setBusy(true);
    try {
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", buffer);
      const workbook = XLSX.read(buffer, { type: "array", raw: false });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const result = parseTaskAllocationTable(XLSX.utils.sheet_to_json<(string | number | boolean | null)[]>(sheet, { header: 1, defval: "", raw: false }));
      if (!result.rows.length) throw new Error("No valid data rows found.");
      setFileHash(Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""));
      setParsed(result); setAssignments({}); setSelectedCities([]);
      setMessage(`Parsed ${result.rows.length} valid tasks, ${result.rejectedRows.length} rejected rows, ${result.cities.length} cities.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to parse file."); }
    finally { setBusy(false); }
  }

  function assignSelected() {
    if (!selectedUser || !selectedCities.length) return;
    setAssignments((current) => ({ ...current, ...Object.fromEntries(selectedCities.map((city) => [normalizeCityKey(city), selectedUser])) }));
    setSelectedCities([]);
  }

  async function allocate() {
    if (!parsed || unmapped.length || !window.confirm(`Assign ${parsed.rows.length} tasks in one atomic batch?`)) return;
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch("/api/task-allocate", { method: "POST", headers: { "Content-Type": "application/json", Authorization: session ? `Bearer ${session.access_token}` : "" }, body: JSON.stringify({ filename: file?.name, fileHash, rows: parsed.rows, cityAssignments: assignments }) });
      const result = await response.json() as { allocatedCount?: number; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Allocation failed.");
      setMessage(`Allocated ${result.allocatedCount ?? parsed.rows.length} tasks successfully.`);
      setFile(null); setParsed(null); setAssignments({}); setSelectedCities([]); setFileHash("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Allocation failed."); }
    finally { setBusy(false); }
  }

  return <section className="space-y-5 rounded-xl border bg-white p-4 sm:p-6">
    <h2 className="text-lg font-bold">Excel Bulk Task Allocation</h2>
    <label className="block text-sm font-semibold">Spreadsheet file
      <input aria-label="Spreadsheet file" className="mt-1 block w-full" type="file" accept=".xlsx,.xls,.csv" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setParsed(null); }} />
    </label>
    {file && <p className="text-xs text-slate-600">{file.name} · {(file.size / 1024).toFixed(1)} KB</p>}
    <button type="button" onClick={parseFile} disabled={!file || busy} className="rounded bg-indigo-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Working…" : "Parse Spreadsheet"}</button>
    {message && <p className="rounded bg-slate-50 p-2 text-sm">{message}</p>}
    {parsed && <>
      <p className="text-sm">{parsed.rows.length} valid · {parsed.rejectedRows.length} rejected · {parsed.cities.length} cities</p>
      <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr><th>Row</th><th>Username</th><th>Name</th><th>City</th><th>Mobile</th></tr></thead><tbody>{parsed.rows.slice(0, 10).map((row) => <tr key={row.rowNumber}><td>{row.rowNumber}</td><td>{row.target_username}</td><td>{row.target_name}</td><td>{row.city}</td><td>{row.target_mobile}</td></tr>)}</tbody></table></div>
      {parsed.rejectedRows.map((row) => <p key={row.rowNumber} className="text-xs text-rose-600">Row {row.rowNumber}: {row.reason}</p>)}
      <div className="flex flex-wrap gap-2"><select aria-label="Active user" value={selectedUser} onChange={(event) => setSelectedUser(event.target.value)}><option value="">Select active user</option>{users.map((user) => <option key={user.user_id} value={user.user_id}>{user.name}</option>)}</select><button type="button" onClick={() => setSelectedCities(parsed.cities)} >Select All Cities</button><button type="button" onClick={assignSelected} disabled={!selectedUser || !selectedCities.length}>Assign Selected Cities</button><button type="button" onClick={() => setSelectedCities([])}>Clear Selected Cities</button><button type="button" onClick={() => setAssignments({})}>Clear All Mappings</button></div>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th>City</th><th>Tasks</th><th>Assigned user</th></tr></thead><tbody>{parsed.cities.map((city) => { const key = normalizeCityKey(city); return <tr key={city} className={!assignments[key] ? "bg-amber-50" : ""}><td><label><input type="checkbox" checked={selectedCities.includes(city)} onChange={() => setSelectedCities((current) => current.includes(city) ? current.filter((item) => item !== city) : [...current, city])} /> {city}</label></td><td>{cityCounts[key]}</td><td><select aria-label={`Assignee for ${city}`} value={assignments[key] ?? ""} onChange={(event) => setAssignments((current) => ({ ...current, [key]: event.target.value }))}><option value="">Unmapped</option>{users.map((user) => <option key={user.user_id} value={user.user_id}>{user.name}</option>)}</select></td></tr>; })}</tbody></table></div>
      {unmapped.length > 0 && <p className="text-sm font-semibold text-amber-700">Unmapped cities: {unmapped.join(", ")}</p>}
      <div className="text-xs">{Object.entries(totals).map(([id, count]) => <p key={id}>{users.find((user) => user.user_id === id)?.name ?? id}: {count} tasks</p>)}</div>
      <button type="button" onClick={allocate} disabled={busy || !Object.keys(assignments).length || unmapped.length > 0} className="rounded bg-emerald-600 px-4 py-2 font-semibold text-white disabled:opacity-50">Assign All Mapped Tasks</button>
    </>}
  </section>;
}
