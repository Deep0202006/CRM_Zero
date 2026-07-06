"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db, LocalClientQuery, LocalLead } from "@/lib/db";
import {
  Headphones,
  AlertCircle,
  CheckCircle2,
  Clock,
  MessageSquare,
  RefreshCw,
  Download,
} from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";
import { exportSupport } from "@/lib/excelExport";

type QueryStatus = "Open" | "In Progress" | "Resolved";

const STATUS_STYLES: Record<QueryStatus, string> = {
  Open:        "bg-rose-50 text-rose-600 border-rose-200",
  "In Progress":"bg-amber-50 text-amber-700 border-amber-200",
  Resolved:    "bg-emerald-50 text-emerald-600 border-emerald-200",
};

export default function SupportPage() {
  const { currentUser, hasDistSupport, hasRetSupport, isAdmin, hasSupport } = useAuth();

  const [leads, setLeads] = useState<LocalLead[]>([]);
  const [queries, setQueries] = useState<LocalClientQuery[]>([]);

  // Form (Queries)
  const [queryLeadId, setQueryLeadId]   = useState("");
  const [queryProblem, setQueryProblem] = useState("");

  const [errorMsg,   setErrorMsg]   = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [filterTab,  setFilterTab]  = useState<"all" | "open" | "resolved">("open");

  // Resolve Modal
  const [resolveModalQuery, setResolveModalQuery] = useState<LocalClientQuery | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState("");

  const QUICK_REPLIES = [
    "Issue fixed remotely",
    "Replaced device/hardware",
    "Customer educated on usage",
    "Escalated to tech team",
    "Resolved on call",
  ];

  const loadData = async () => {
    try {
      const allLeads = await db.leads.toArray();

      // Segment-scope: dist_support → distributors, ret_support → retailers, admin → all
      let scopedLeads = allLeads;
      if (!isAdmin) {
        const allowed: string[] = [];
        if (hasDistSupport) allowed.push("Distributor");
        if (hasRetSupport)  allowed.push("Retailer");
        scopedLeads = allLeads.filter(l => allowed.includes(l.segment_type));
      }
      setLeads(scopedLeads);

      const allQueries = await db.client_queries.orderBy("created_at").reverse().toArray();
      // Filter queries to scoped lead IDs
      const scopedIds = new Set(scopedLeads.map(l => l.lead_id));
      setQueries(allQueries.filter(q => scopedIds.has(q.lead_id)));
    } catch (err) {
      console.error("Failed to load support data", err);
    }
  };

  useEffect(() => { loadData(); }, [currentUser]);

  // ── Log new query ─────────────────────────────────────────────────────────
  const handleLogQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!queryLeadId || !queryProblem.trim()) {
      setErrorMsg("Select a client and describe the issue.");
      return;
    }
    try {
      const newQuery: LocalClientQuery = {
        query_id:       crypto.randomUUID(),
        lead_id:        queryLeadId,
        client_problem: queryProblem.trim(),
        problem_status: "Open", // Always Open
        assigned_to:    currentUser?.user_id || null,
        created_at:     new Date().toISOString(),
      };
      await db.client_queries.add(newQuery);
      await db.sync_queue.add({ idempotency_key: crypto.randomUUID(),  table_name: "client_queries", action: "INSERT", data: newQuery, timestamp: new Date().toISOString() });

      setSuccessMsg("Query logged.");
      setTimeout(() => setSuccessMsg(null), 2500);
      setQueryLeadId("");
      setQueryProblem("");
      await loadData();
    } catch (err) {
      setErrorMsg("Failed to log query.");
    }
  };

  // ── Update query status ───────────────────────────────────────────────────
  const handleUpdateStatus = async (query: LocalClientQuery, newStatus: QueryStatus) => {
    try {
      const updates: Partial<LocalClientQuery & { resolved_at?: string }> = { problem_status: newStatus };
      if (newStatus === "Resolved") updates.resolved_at = new Date().toISOString();
      await db.client_queries.update(query.query_id, updates);
      await db.sync_queue.add({ idempotency_key: crypto.randomUUID(),  table_name: "client_queries", action: "UPDATE", data: { query_id: query.query_id, ...updates }, timestamp: new Date().toISOString() });
      await loadData();
    } catch (err) {
      setErrorMsg("Failed to update query status.");
    }
  };

  const handleResolveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resolveModalQuery || !resolutionNotes.trim()) return;
    try {
      const updates: Partial<LocalClientQuery & { resolved_at?: string; resolution_notes?: string; resolved_by?: string }> = {
        problem_status: "Resolved",
        resolved_at: new Date().toISOString(),
        resolution_notes: resolutionNotes.trim(),
        resolved_by: currentUser?.user_id
      };
      await db.client_queries.update(resolveModalQuery.query_id, updates);
      await db.sync_queue.add({ idempotency_key: crypto.randomUUID(),  table_name: "client_queries", action: "UPDATE", data: { query_id: resolveModalQuery.query_id, ...updates }, timestamp: new Date().toISOString() });
      await loadData();
      setResolveModalQuery(null);
      setResolutionNotes("");
    } catch (err) {
      setErrorMsg("Failed to resolve query.");
    }
  };

  const getLeadName = (id: string) => leads.find(l => l.lead_id === id)?.business_name || "Unknown";

  const filteredQueries = queries.filter(q => {
    if (filterTab === "open")     return q.problem_status !== "Resolved";
    if (filterTab === "resolved") return q.problem_status === "Resolved";
    return true;
  });

  const openCount     = queries.filter(q => q.problem_status === "Open").length;
  const inProgCount   = queries.filter(q => q.problem_status === "In Progress").length;
  const resolvedCount = queries.filter(q => q.problem_status === "Resolved").length;

  if (!hasSupport) {
    return (
      <div className="max-w-md mx-auto mt-16 p-8 bg-white rounded-3xl border border-slate-100 shadow-sm text-center space-y-4">
        <AlertCircle size={40} className="mx-auto text-status-error" />
        <h3 className="text-lg font-black text-slate-900">Access Restricted</h3>
        <p className="text-xs text-slate-500 font-semibold">You don't have a Support capability assigned.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Headphones size={20} className="text-brand-primary" />
          <div>
            <h2 className="text-2xl font-black text-slate-900">Support & Operations</h2>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
              {isAdmin ? "All segments" : [hasDistSupport && "Distributors", hasRetSupport && "Retailers"].filter(Boolean).join(" & ")}
            </p>
          </div>
        </div>
        
        <button
          onClick={() => {
            if (currentUser) exportSupport(currentUser.user_id);
          }}
          className="flex items-center gap-1.5 px-3 py-2 bg-brand-primary text-white rounded-xl text-xs font-black cursor-pointer hover:bg-brand-secondary transition-all w-fit"
        >
          <Download size={14} /> Download Queries
        </button>
      </div>

      {/* KPI summary row */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Open",       value: openCount,     color: "text-rose-500",    bg: "bg-rose-50 border-rose-100" },
          { label: "In Progress",value: inProgCount,   color: "text-amber-600",   bg: "bg-amber-50 border-amber-100" },
          { label: "Resolved",   value: resolvedCount, color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-100" },
        ].map(c => (
          <div key={c.label} className={`rounded-2xl border p-4 ${c.bg}`}>
            <p className={`text-2xl font-black ${c.color}`}>{c.value}</p>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-0.5">{c.label}</p>
          </div>
        ))}
      </div>

      {/* Feedback */}
      {successMsg && <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-700 text-xs font-bold">✓ {successMsg}</div>}
      {errorMsg   && <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-600 text-xs font-bold flex gap-2 items-center"><AlertCircle size={14}/>{errorMsg}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* ── Log Query Form ── */}
        <div className="lg:col-span-2 bg-white rounded-3xl border border-slate-100 shadow-sm p-6 space-y-4">
          <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
            <MessageSquare size={16} className="text-brand-primary" />
            Log Client Query
          </h3>

          <form onSubmit={handleLogQuery} className="space-y-4">
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                Client Account
              </label>
              <SearchableSelect
                options={leads.map(l => ({ value: l.lead_id, label: `${l.business_name} (${l.segment_type})` }))}
                value={queryLeadId}
                onChange={setQueryLeadId}
                placeholder="— Search Client —"
                required
              />
            </div>

            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                Problem Description
              </label>
              <textarea
                required
                rows={3}
                value={queryProblem}
                onChange={e => setQueryProblem(e.target.value)}
                placeholder="Describe the issue reported by the client…"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold text-slate-900 placeholder-slate-300 focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10 transition-all resize-none"
              />
            </div>

            <button
              type="submit"
              className="w-full py-3.5 bg-brand-primary hover:bg-brand-secondary text-white font-black rounded-2xl transition-all shadow-md shadow-brand-primary/10 text-xs tracking-wider uppercase cursor-pointer"
            >
              Log Query
            </button>
          </form>
        </div>

        {/* ── Query Queue ── */}
        <div className="lg:col-span-3 bg-white rounded-3xl border border-slate-100 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
              <Clock size={16} className="text-brand-secondary" /> Query Queue
            </h3>
            <button onClick={loadData} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 cursor-pointer" title="Refresh">
              <RefreshCw size={14} />
            </button>
          </div>

          {/* Filter tabs */}
          <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
            {(["open", "all", "resolved"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setFilterTab(tab)}
                className={`flex-1 py-1.5 rounded-lg text-[11px] font-black transition-all cursor-pointer capitalize ${
                  filterTab === tab ? "bg-white text-brand-primary shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}
              >
                {tab === "open" ? `Open (${openCount})` : tab === "resolved" ? `Resolved (${resolvedCount})` : "All"}
              </button>
            ))}
          </div>

          <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
            {filteredQueries.length === 0 && (
              <p className="text-xs italic text-slate-400 text-center py-10 font-semibold">No queries in this view.</p>
            )}
            {filteredQueries.map(query => (
              <div
                key={query.query_id}
                className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-3 hover:border-slate-200 transition-all"
              >
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                      {getLeadName(query.lead_id)}
                    </p>
                    <p className="text-sm font-bold text-slate-900 mt-0.5 leading-snug">
                      "{query.client_problem}"
                    </p>
                  </div>
                  <span className={`shrink-0 text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${STATUS_STYLES[query.problem_status as QueryStatus]}`}>
                    {query.problem_status}
                  </span>
                </div>

                <div className="flex items-center justify-between text-[10px] text-slate-400 font-semibold border-t border-slate-200/50 pt-2">
                  <span>{new Date(query.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  {/* Quick action buttons */}
                  {query.problem_status !== "Resolved" && (
                    <div className="flex gap-1.5">
                      {query.problem_status === "Open" && (
                        <button
                          onClick={() => handleUpdateStatus(query, "In Progress")}
                          className="px-2.5 py-1 bg-amber-50 text-amber-700 border border-amber-200 rounded-lg text-[10px] font-black hover:bg-amber-100 transition-all cursor-pointer"
                        >
                          Start →
                        </button>
                      )}
                      <button
                        onClick={() => setResolveModalQuery(query)}
                        className="px-2.5 py-1 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-lg text-[10px] font-black hover:bg-emerald-100 transition-all cursor-pointer"
                      >
                        Resolve ✓
                      </button>
                    </div>
                  )}
                  {query.problem_status === "Resolved" && (
                    <span className="text-emerald-500 font-black flex items-center gap-1"><CheckCircle2 size={10}/> Done</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Resolve Modal */}
      {resolveModalQuery && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl w-full max-w-sm shadow-xl p-6">
            <h3 className="text-lg font-black text-slate-900 mb-2 flex items-center gap-2">
              <CheckCircle2 size={18} className="text-emerald-500" /> Mark Resolved
            </h3>
            <p className="text-xs font-semibold text-slate-500 mb-4">
              {getLeadName(resolveModalQuery.lead_id)}
            </p>
            <form onSubmit={handleResolveSubmit} className="space-y-4">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                  How was this resolved?
                </label>

                {/* One-tap chips */}
                <div className="flex flex-wrap gap-2 mb-3">
                  {QUICK_REPLIES.map((reply) => (
                    <button
                      key={reply}
                      type="button"
                      onClick={() => setResolutionNotes(reply)}
                      className={`px-3 py-1.5 rounded-full border text-[11px] font-bold cursor-pointer transition-all ${
                        resolutionNotes === reply
                          ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                          : "bg-white border-slate-200 text-slate-600 hover:border-emerald-200 hover:text-emerald-600"
                      }`}
                    >
                      {reply}
                    </button>
                  ))}
                </div>

                <input
                  required
                  value={resolutionNotes}
                  onChange={e => setResolutionNotes(e.target.value)}
                  placeholder="Or type your own (a few words is fine)"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold text-slate-900 focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setResolveModalQuery(null); setResolutionNotes(""); }}
                  className="flex-1 py-3 bg-slate-100 text-slate-600 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-slate-200 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!resolutionNotes.trim()}
                  className="flex-1 py-3 bg-emerald-600 text-white rounded-xl text-xs font-black uppercase tracking-wider disabled:opacity-50 hover:bg-emerald-700 cursor-pointer shadow-md shadow-emerald-600/20"
                >
                  Confirm
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
