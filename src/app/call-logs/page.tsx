"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db, transactionalMutation } from "@/lib/db";
import { SearchableSelect } from "@/components/SearchableSelect";
import { SearchableOption } from "@/components/SearchableSelect";
import { PhoneCall, CheckCircle2, AlertCircle, Download } from "lucide-react";
import excelUsers from "@/lib/excel_users.json";
import { exportCallLogs } from "@/lib/excelExport";
export default function CallLogsPage() {
  const { currentUser, isAdmin } = useAuth();
  
  const [loading, setLoading] = useState(true);
  
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

  useEffect(() => {
    // Mock loading delay to match existing pattern if needed
    setLoading(false);
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

      const log = {
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
        const leadDisplay = leadNameMatch.length === 3 ? `${leadNameMatch[2]} (@${leadNameMatch[1]})` : selectedLeadId;
        
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
      
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || "Failed to log call.");
    } finally {
      setSubmitting(false);
    }
  };

  const showFollowup = outcome === "No response (followup)" || outcome === "Requested more info";

  return (
    <main className="flex-1 p-6 lg:p-10 pt-20 max-w-4xl mx-auto">
      <div className="flex sm:flex-row flex-col sm:items-center justify-between gap-4 mb-10">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center shadow-sm">
            <PhoneCall size={24} />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Log a Call</h1>
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

      <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        {loading ? (
          <div className="flex justify-center p-8 text-slate-400">Loading options...</div>
        ) : (
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
                className="bg-brand-primary text-white font-bold px-8 py-3 rounded-xl shadow-[0_4px_14px_0_rgba(10,51,217,0.39)] hover:shadow-[0_6px_20px_rgba(10,51,217,0.23)] hover:-translate-y-0.5 transition-all disabled:opacity-50 disabled:pointer-events-none"
              >
                {submitting ? "Logging..." : "Log Call"}
              </button>
            </div>
          </form>
        )}
      </div>
    </main>
  );
}
