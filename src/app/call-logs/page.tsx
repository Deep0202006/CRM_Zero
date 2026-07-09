"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db, transactionalMutation, LocalCallLog, LocalUser, LocalLead } from "@/lib/db";
import { SearchableSelect, SearchableOption } from "@/components/SearchableSelect";
import { PhoneCall, CheckCircle2, AlertCircle, Download, Clock } from "lucide-react";
import excelUsers from "@/lib/excel_users.json";
import { exportCallLogs } from "@/lib/excelExport";
import { QueueList, QueueItem } from "@/components/QueueList";

export default function CallLogsPage() {
  const { currentUser, isAdmin } = useAuth();
  
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<LocalCallLog[]>([]);
  const [usersMap, setUsersMap] = useState<Map<string, LocalUser>>(new Map());
  const [leadsMap, setLeadsMap] = useState<Map<string, LocalLead>>(new Map());
  
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [outcome, setOutcome] = useState("");
  const [notes, setNotes] = useState("");
  const [nextFollowup, setNextFollowup] = useState("");
  
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const commonOutcomes = [
    "No response (followup)",
    "Happy call",
    "Not interested",
    "Requested more info",
    "Wrong Number",
    "Other"
  ];

  const leadOptions = React.useMemo(() => {
    const excelOptions: SearchableOption[] = excelUsers.map((eu: any) => ({
      value: `EXCEL::${eu.username}::${eu.name || eu.username}`,
      label: `[${eu.username}] - ${eu.name || "Unknown"}`,
      searchText: eu.username + " " + eu.name
    }));
    return excelOptions.sort((a, b) => a.label.localeCompare(b.label));
  }, []);

  const loadData = async () => {
    try {
      const fetchedLogs = await db.call_logs.toArray();
      // Sort by descending timestamp
      fetchedLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      
      const allUsers = await db.users.toArray();
      const uMap = new Map<string, LocalUser>();
      allUsers.forEach(u => uMap.set(u.user_id, u));
      
      const allLeads = await db.leads.toArray();
      const lMap = new Map<string, LocalLead>();
      allLeads.forEach(l => lMap.set(l.lead_id, l));
      
      setUsersMap(uMap);
      setLeadsMap(lMap);
      setLogs(fetchedLogs);
    } catch (err) {
      console.error("Failed to load logs:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleLogCall = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) return;
    
    if (!selectedLeadId && !outcome) {
      setError("Please select a lead and provide an outcome.");
      return;
    }
    if (!selectedLeadId) {
      setError("Please select a lead.");
      return;
    }
    if (!outcome) {
      setError("Please select a call outcome/response.");
      return;
    }

    setSubmitting(true);
    setError("");
    setSuccess(false);

    try {
      const nextFollowupDate = (outcome === "No response (followup)" || outcome === "Requested more info") ? (nextFollowup || null) : null;

      const log: LocalCallLog = {
        log_id: crypto.randomUUID(),
        user_id: currentUser.user_id,
        lead_id: selectedLeadId, // This is now in format EXCEL::username::name
        timestamp: new Date().toISOString(),
        outcome: outcome,
        notes: notes.trim() || null,
        next_followup_date: nextFollowupDate,
      };

      await transactionalMutation("call_logs", "INSERT", log);

      if (nextFollowupDate) {
        const leadNameMatch = selectedLeadId.split("::");
        const leadDisplay = leadNameMatch.length === 3 ? `[${leadNameMatch[1]}] - ${leadNameMatch[2]}` : selectedLeadId;
        
        const followupTask = {
          task_id: crypto.randomUUID(),
          assigned_to: currentUser.user_id,
          assigned_by: currentUser.user_id,
          title: "Follow-up Call",
          description: `Scheduled follow-up for: ${leadDisplay}\nNotes: ${notes.trim() || "No notes"}`,
          priority: "High" as const,
          status: "Pending" as const,
          source: "manual" as const,
          template_id: null,
          related_lead_id: selectedLeadId,
          due_date: nextFollowupDate,
          started_at: null,
          completed_at: null,
          proof_note: null,
          proof_photo_url: null,
          created_at: new Date().toISOString(),
        };
        await transactionalMutation("tasks", "INSERT", followupTask);
      }

      setSuccess(true);
      
      // Reset form
      setSelectedLeadId("");
      setOutcome("");
      setNotes("");
      setNextFollowup("");
      
      await loadData();
      
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || "Failed to log call.");
    } finally {
      setSubmitting(false);
    }
  };

  const showFollowup = outcome === "No response (followup)" || outcome === "Requested more info";

  const getLeadDisplay = (lead_id: string) => {
    if (lead_id.startsWith("EXCEL::")) {
      const parts = lead_id.split("::");
      if (parts.length === 3) {
        return `[${parts[1]}] - ${parts[2]}`;
      }
    }
    const lead = leadsMap.get(lead_id);
    if (lead) {
      return `[${lead.business_name}] - ${lead.contact_person || lead.phone || "Unknown"}`;
    }
    return lead_id;
  };

  const getAgentDisplay = (user_id?: string | null) => {
    if (!user_id) return "System/Unknown";
    const user = usersMap.get(user_id);
    if (!user) return "Unknown Agent";
    return `${user.name} (@${user.email})`;
  };

  return (
    <main className="flex-1 p-6 lg:p-10 pt-20 w-full max-w-7xl mx-auto space-y-6">
      <div className="flex sm:flex-row flex-col sm:items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center shadow-sm">
            <PhoneCall size={24} />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Call Logs</h1>
            <p className="text-slate-500 mt-1">Record manual calls made to distributors and retailers.</p>
          </div>
        </div>
        
        {currentUser && (
          <button
            onClick={() => exportCallLogs(currentUser.user_id, isAdmin)}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-semibold rounded-xl transition-colors border border-emerald-200 shadow-sm"
          >
            <Download size={18} />
            <span>Download Excel</span>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-2 bg-white rounded-3xl p-6 border border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)] h-fit">
          <h3 className="text-base font-black text-slate-900 flex items-center gap-2 mb-6">
            <PhoneCall size={16} className="text-brand-primary" />
            Log Call
          </h3>
          <form onSubmit={handleLogCall} className="space-y-6">
            {/* Lead Selection */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Select Lead
              </label>
              <SearchableSelect
                options={leadOptions}
                value={selectedLeadId}
                onChange={setSelectedLeadId}
                placeholder="Search by name, contact, or phone..."
                required
              />
            </div>

            {/* Call Outcome / Response */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Call Response / Outcome
              </label>
              <select
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-900 focus-within:border-brand-primary focus-within:ring-2 focus-within:ring-brand-primary/10 transition-all outline-none appearance-none"
                required
              >
                <option value="" disabled>Select an outcome...</option>
                {commonOutcomes.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Additional Notes <span className="text-slate-400 font-normal">(Optional)</span>
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Any important details discussed..."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-900 focus-within:border-brand-primary focus-within:ring-2 focus-within:ring-brand-primary/10 transition-all outline-none min-h-[100px] resize-y"
              />
            </div>

            {/* Next Followup (Conditional) */}
            {showFollowup && (
              <div className="animate-in fade-in slide-in-from-top-4 duration-300">
                <label className="block text-sm font-semibold text-slate-700 mb-2">
                  Next Follow-up Date <span className="text-slate-400 font-normal">(Optional)</span>
                </label>
                <input
                  type="date"
                  value={nextFollowup}
                  onChange={(e) => setNextFollowup(e.target.value)}
                  className="w-full sm:w-64 bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:outline-none focus:border-brand-primary transition-all"
                />
              </div>
            )}

            {error && (
              <div className="p-4 bg-rose-50 text-rose-700 rounded-xl flex items-start gap-3 border border-rose-100">
                <AlertCircle size={18} className="mt-0.5" />
                <p className="text-sm font-medium">{error}</p>
              </div>
            )}

            {success && (
              <div className="p-4 bg-emerald-50 text-emerald-700 rounded-xl flex items-center gap-3 border border-emerald-100">
                <CheckCircle2 size={18} />
                <p className="text-sm font-medium">Call logged successfully!</p>
              </div>
            )}

            <div className="pt-4 flex justify-end">
              <button
                type="submit"
                disabled={submitting}
                className="bg-brand-primary text-white font-bold px-8 py-3 rounded-xl shadow-[0_4px_14px_0_rgba(10,51,217,0.39)] hover:shadow-[0_6px_20px_rgba(10,51,217,0.23)] hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:pointer-events-none w-full"
              >
                {submitting ? "Logging..." : "Log Call"}
              </button>
            </div>
          </form>
        </div>

        {/* Queue Template Section */}
        <QueueList
          title="Call History"
          items={logs.map(log => ({
            id: log.log_id,
            primaryNode: (
              <div>
                <p className="text-sm font-bold text-slate-900 mt-0.5 leading-snug">
                  {getLeadDisplay(log.lead_id)}
                </p>
                <p className="text-[10px] font-semibold text-slate-500 mt-1 uppercase tracking-wider">
                  Agent: <span className="text-slate-700">{getAgentDisplay(log.user_id)}</span>
                </p>
                {log.notes && (
                  <p className="text-xs text-slate-500 mt-2 bg-slate-100 p-2 rounded-lg italic">
                    {log.notes}
                  </p>
                )}
              </div>
            ),
            statusText: log.outcome,
            statusColorClasses: "bg-indigo-50 text-indigo-600 border-indigo-200",
            timestamp: new Date(log.timestamp).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
          }))}
          emptyMessage="No calls logged yet."
          onRefresh={loadData}
        />
      </div>
    </main>
  );
}
