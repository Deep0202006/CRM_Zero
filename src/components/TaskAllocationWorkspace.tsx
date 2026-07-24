"use client";

import { useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import { getCityTaskCounts, normalizeCityKey, parseTaskAllocationTable, type CityAssignmentMap, type ParsedTaskAllocationFile } from "@/lib/taskAllocationExcel";
import { FileSpreadsheet, UploadCloud, AlertCircle, CheckCircle2, MapPin, Users, Send } from "lucide-react";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // Increased to 10MB since we no longer hit Next.js 4MB limits
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
  const [message, setMessage] = useState({ text: "", type: "info" as "info" | "success" | "error" });
  
  const users = useMemo(() => allUsers.filter((user) => isActive(user.is_active)), [allUsers]);
  const cityCounts = useMemo(() => parsed ? getCityTaskCounts(parsed.rows) : {}, [parsed]);
  const unmapped = useMemo(() => parsed?.cities.filter((city) => !assignments[normalizeCityKey(city)]) ?? [], [parsed, assignments]);
  const totals = useMemo(() => Object.entries(assignments).reduce<Record<string, number>>((result, [city, userId]) => ({ ...result, [userId]: (result[userId] ?? 0) + (cityCounts[city] ?? 0) }), {}), [assignments, cityCounts]);

  async function parseFile() {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES || !/\.(xlsx|xls|csv)$/i.test(file.name)) { 
      setMessage({ text: "Use an XLSX, XLS, or CSV file up to 10 MB.", type: "error" }); 
      return; 
    }
    setBusy(true);
    setMessage({ text: "", type: "info" });
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
      setMessage({ text: `Parsed ${result.rows.length} valid tasks, ${result.rejectedRows.length} rejected rows, ${result.cities.length} cities.`, type: "success" });
    } catch (error) { 
      setMessage({ text: error instanceof Error ? error.message : "Unable to parse file.", type: "error" }); 
    } finally { 
      setBusy(false); 
    }
  }

  function assignSelected() {
    if (!selectedUser || !selectedCities.length) return;
    setAssignments((current) => ({ ...current, ...Object.fromEntries(selectedCities.map((city) => [normalizeCityKey(city), selectedUser])) }));
    setSelectedCities([]);
  }

  async function allocate() {
    if (!parsed || unmapped.length || !window.confirm(`Assign ${parsed.rows.length} tasks in one atomic batch?`)) return;
    setBusy(true);
    setMessage({ text: "Allocating tasks directly to database...", type: "info" });
    try {
      const { data, error } = await supabase.rpc("allocate_city_task_batch", {
        p_filename: file?.name ?? "upload.xlsx",
        p_file_hash: fileHash,
        p_rows: parsed.rows,
        p_city_assignments: assignments
      });

      if (error) {
        // Map common postgres errors to readable text
        const errMsg = error.code === '23505' ? 'This file has already been processed (duplicate hash).' : 
                       error.code === '42501' ? 'You are not authorized to allocate tasks.' : error.message;
        throw new Error(errMsg);
      }
      
      const res = data as any;
      setMessage({ text: `Allocated ${res?.allocatedCount ?? parsed.rows.length} tasks successfully in batch ${res?.batchId ?? ''}.`, type: "success" });
      setFile(null); setParsed(null); setAssignments({}); setSelectedCities([]); setFileHash("");
    } catch (error) { 
      setMessage({ text: error instanceof Error ? error.message : "Allocation failed.", type: "error" }); 
    } finally { 
      setBusy(false); 
    }
  }

  return (
    <div className="space-y-6 w-full max-w-6xl mx-auto">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <FileSpreadsheet size={24} className="text-brand-primary" />
          <h1 className="text-2xl font-black text-slate-900">Bulk Task Allocation</h1>
        </div>
        <p className="text-xs text-slate-400 font-bold tracking-wider uppercase">Assign field targets via Excel</p>
      </div>

      {/* Upload Zone */}
      <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
        <label className="block text-sm font-black text-slate-900 mb-3">Select Spreadsheet</label>
        
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <label className="relative flex-1 w-full flex items-center justify-center px-4 py-8 border-2 border-slate-200 border-dashed rounded-xl cursor-pointer hover:border-brand-primary hover:bg-brand-50 transition-colors">
            <input 
              type="file" 
              accept=".xlsx,.xls,.csv" 
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              onChange={(event) => { setFile(event.target.files?.[0] ?? null); setParsed(null); setMessage({text:"", type:"info"}); }} 
            />
            <div className="flex flex-col items-center gap-2 text-center pointer-events-none">
              <UploadCloud size={32} className={file ? "text-brand-primary" : "text-slate-400"} />
              <div>
                <p className="text-sm font-bold text-slate-700">{file ? file.name : "Click to select or drag and drop"}</p>
                <p className="text-[11px] font-semibold text-slate-400 mt-1">{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : "XLSX, XLS, or CSV up to 10MB"}</p>
              </div>
            </div>
          </label>
          
          <button 
            type="button" 
            onClick={parseFile} 
            disabled={!file || busy} 
            className="w-full sm:w-auto shrink-0 bg-brand-primary text-white px-6 py-4 rounded-xl text-sm font-black hover:bg-brand-secondary transition-all disabled:opacity-50 disabled:hover:bg-brand-primary shadow-sm shadow-brand-primary/20"
          >
            {busy ? "Parsing..." : "Parse Spreadsheet"}
          </button>
        </div>

        {/* Message Alert */}
        {message.text && (
          <div className={`mt-4 p-4 rounded-xl flex items-start gap-3 border ${
            message.type === 'error' ? 'bg-rose-50 border-rose-200 text-rose-700' : 
            message.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 
            'bg-blue-50 border-blue-200 text-blue-700'
          }`}>
            {message.type === 'error' ? <AlertCircle size={20} className="shrink-0 mt-0.5" /> : 
             message.type === 'success' ? <CheckCircle2 size={20} className="shrink-0 mt-0.5" /> : 
             <AlertCircle size={20} className="shrink-0 mt-0.5" />}
            <p className="text-sm font-semibold">{message.text}</p>
          </div>
        )}
      </section>

      {/* Parsed Data and Mapping */}
      {parsed && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          {/* Main Mapping Area */}
          <div className="lg:col-span-8 space-y-6">
            <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[11px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5">
                  <MapPin size={14} className="text-brand-primary" /> City Mapping
                </h2>
                <div className="text-xs font-bold px-3 py-1 bg-slate-100 rounded-full text-slate-600">
                  {parsed.cities.length} Unique Cities
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 mb-4 p-4 bg-slate-50 rounded-xl border border-slate-100">
                <div className="flex-1">
                  <select 
                    aria-label="Active user" 
                    value={selectedUser} 
                    onChange={(event) => setSelectedUser(event.target.value)}
                    className="w-full bg-white border border-slate-200 text-slate-900 text-sm rounded-xl px-3 py-2 font-semibold focus:ring-2 focus:ring-brand-primary focus:border-transparent outline-none transition-all"
                  >
                    <option value="">Select an assignee...</option>
                    {users.map((user) => <option key={user.user_id} value={user.user_id}>{user.name}</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                  <button type="button" onClick={assignSelected} disabled={!selectedUser || !selectedCities.length} className="px-4 py-2 bg-indigo-600 text-white text-xs font-black rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-all">Assign Selected</button>
                  <button type="button" onClick={() => setSelectedCities(parsed.cities)} className="px-3 py-2 bg-white border border-slate-200 text-slate-700 text-xs font-bold rounded-xl hover:bg-slate-50 transition-all">All</button>
                  <button type="button" onClick={() => setSelectedCities([])} className="px-3 py-2 bg-white border border-slate-200 text-slate-700 text-xs font-bold rounded-xl hover:bg-slate-50 transition-all">None</button>
                </div>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="max-h-[500px] overflow-y-auto">
                  <table className="min-w-full divide-y divide-slate-200">
                    <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                      <tr>
                        <th className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-wider">City / Region</th>
                        <th className="px-4 py-3 text-center text-[10px] font-black text-slate-500 uppercase tracking-wider">Tasks</th>
                        <th className="px-4 py-3 text-left text-[10px] font-black text-slate-500 uppercase tracking-wider">Assigned User</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-slate-100">
                      {parsed.cities.map((city) => { 
                        const key = normalizeCityKey(city); 
                        const isMapped = !!assignments[key];
                        return (
                          <tr key={city} className={`hover:bg-slate-50 transition-colors ${!isMapped ? "bg-amber-50/50" : ""}`}>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <label className="flex items-center gap-3 cursor-pointer">
                                <input 
                                  type="checkbox" 
                                  className="w-4 h-4 rounded text-brand-primary border-slate-300 focus:ring-brand-primary"
                                  checked={selectedCities.includes(city)} 
                                  onChange={() => setSelectedCities((current) => current.includes(city) ? current.filter((item) => item !== city) : [...current, city])} 
                                /> 
                                <span className="text-sm font-bold text-slate-900">{city}</span>
                              </label>
                            </td>
                            <td className="px-4 py-3 whitespace-nowrap text-center">
                              <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-black">{cityCounts[key]}</span>
                            </td>
                            <td className="px-4 py-2 whitespace-nowrap">
                              <select 
                                aria-label={`Assignee for ${city}`} 
                                value={assignments[key] ?? ""} 
                                onChange={(event) => setAssignments((current) => ({ ...current, [key]: event.target.value }))}
                                className={`w-full text-xs font-semibold rounded-lg px-2 py-1.5 border outline-none focus:ring-2 focus:ring-brand-primary/50 transition-all ${
                                  isMapped ? "bg-white border-slate-200 text-slate-900" : "bg-amber-100/50 border-amber-200 text-amber-700"
                                }`}
                              >
                                <option value="">⚠️ Unmapped</option>
                                {users.map((user) => <option key={user.user_id} value={user.user_id}>{user.name}</option>)}
                              </select>
                            </td>
                          </tr>
                        ); 
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          </div>

          {/* Sidebar / Submission */}
          <div className="lg:col-span-4 space-y-6">
            <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 sticky top-6">
              <h2 className="text-[11px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5 mb-4">
                <Users size={14} className="text-emerald-500" /> Assignment Summary
              </h2>
              
              <div className="space-y-3 mb-6 max-h-[300px] overflow-y-auto pr-2">
                {Object.keys(totals).length === 0 ? (
                  <p className="text-sm text-slate-400 font-semibold italic text-center py-4">No tasks assigned yet.</p>
                ) : (
                  Object.entries(totals).sort((a, b) => b[1] - a[1]).map(([id, count]) => {
                    const userName = users.find((user) => user.user_id === id)?.name ?? "Unknown";
                    return (
                      <div key={id} className="flex items-center justify-between p-3 bg-slate-50 rounded-xl border border-slate-100">
                        <span className="text-sm font-bold text-slate-800">{userName}</span>
                        <span className="text-xs font-black bg-brand-primary/10 text-brand-primary px-2.5 py-1 rounded-full">{count}</span>
                      </div>
                    );
                  })
                )}
              </div>

              {unmapped.length > 0 && (
                <div className="mb-6 p-3 bg-amber-50 rounded-xl border border-amber-200 flex items-start gap-2">
                  <AlertCircle size={16} className="text-amber-600 mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs font-black text-amber-800 mb-1">{unmapped.length} Unmapped Cities</p>
                    <p className="text-[10px] text-amber-700 font-semibold leading-relaxed">All cities must be assigned to a user before allocation can proceed.</p>
                  </div>
                </div>
              )}

              <button 
                type="button" 
                onClick={allocate} 
                disabled={busy || !Object.keys(assignments).length || unmapped.length > 0} 
                className="w-full flex items-center justify-center gap-2 bg-emerald-600 text-white px-4 py-4 rounded-xl text-sm font-black hover:bg-emerald-700 transition-all disabled:opacity-50 disabled:hover:bg-emerald-600 shadow-sm shadow-emerald-600/20"
              >
                <Send size={18} />
                {busy ? "Allocating..." : "Assign All Mapped Tasks"}
              </button>
            </section>
          </div>

        </div>
      )}
    </div>
  );
}
