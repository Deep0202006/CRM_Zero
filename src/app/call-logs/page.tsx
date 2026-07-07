"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db, queueOfflineMutation } from "@/lib/db";
import { SearchableSelect } from "@/components/SearchableSelect";
import { PhoneCall, CheckCircle2, AlertCircle } from "lucide-react";

export default function CallLogsPage() {
  const { currentUser } = useAuth();
  
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [outcome, setOutcome] = useState("");
  const [notes, setNotes] = useState("");
  const [nextFollowup, setNextFollowup] = useState("");
  
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const commonOutcomes = [
    "Interested - Follow up",
    "Not Interested",
    "Busy - Call back later",
    "Wrong Number",
    "Requested Demo",
    "Converted",
  ];

  useEffect(() => {
    async function loadLeads() {
      try {
        const allLeads = await db.leads.orderBy("created_at").reverse().toArray();
        setLeads(allLeads);
      } catch (err) {
        console.error("Failed to load leads:", err);
      } finally {
        setLoading(false);
      }
    }
    loadLeads();
  }, []);

  const leadOptions = leads.map(l => ({
    value: l.lead_id,
    label: `[${l.segment_type}] ${l.business_name} (${l.contact_person}) | ${l.phone}`,
    searchText: l.phone + " " + l.contact_person
  }));

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
      setError("Please enter or select a call outcome/response.");
      return;
    }

    setSubmitting(true);
    setError("");
    setSuccess(false);

    try {
      const log = {
        log_id: crypto.randomUUID(),
        user_id: currentUser.user_id,
        lead_id: selectedLeadId,
        timestamp: new Date().toISOString(),
        outcome: outcome,
        notes: notes.trim() || null,
        next_followup_date: nextFollowup || null,
      };

      await db.call_logs.add(log);
      await queueOfflineMutation("call_logs", "INSERT", log);

      setSuccess(true);
      
      // Reset form (keep selected lead if they want to log another, or clear it)
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

  return (
    <main className="flex-1 p-6 lg:p-10 pt-20 max-w-4xl mx-auto">
      <div className="flex items-center gap-4 mb-10">
        <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center shadow-sm">
          <PhoneCall size={24} />
        </div>
        <div>
          <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">Log a Call</h1>
          <p className="text-slate-500 mt-1">Record manual calls made to distributors and retailers.</p>
        </div>
      </div>

      <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
        {loading ? (
          <div className="flex justify-center p-8 text-slate-400">Loading leads...</div>
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
              <input
                type="text"
                list="outcome-suggestions"
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
                placeholder="Type response or select from dropdown..."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-900 focus-within:border-brand-primary focus-within:ring-2 focus-within:ring-brand-primary/10 transition-all outline-none"
                required
              />
              <datalist id="outcome-suggestions">
                {commonOutcomes.map((opt) => (
                  <option key={opt} value={opt} />
                ))}
              </datalist>
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

            {/* Next Followup */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-2">
                Next Follow-up Date <span className="text-slate-400 font-normal">(Optional)</span>
              </label>
              <input
                type="date"
                value={nextFollowup}
                onChange={(e) => setNextFollowup(e.target.value)}
                className="w-full sm:w-64 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm font-semibold text-slate-900 focus-within:border-brand-primary focus-within:ring-2 focus-within:ring-brand-primary/10 transition-all outline-none"
              />
            </div>

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
