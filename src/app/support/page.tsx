"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db, transactionalMutation, LocalClientQuery } from "@/lib/db";
import {
  Headphones,
  AlertCircle,
  CheckCircle2,
  Clock,
  MessageSquare,
  Download,
} from "lucide-react";
import { exportSupport } from "@/lib/excelExport";
import { SearchableSelect, SearchableOption } from "@/components/SearchableSelect";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import excelUsers from "@/lib/excel_users.json";

type QueryStatus = "Open" | "In Progress" | "Resolved";

export default function SupportPage() {
  const { currentUser, hasDistSupport, hasRetSupport, isAdmin, hasSupport } = useAuth();

  const [queries, setQueries] = useState<LocalClientQuery[]>([]);
  const [clientNameInput, setClientNameInput] = useState("");
  const [queryProblem, setQueryProblem] = useState("");

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<"all" | "open" | "resolved">("open");

  const clientOptions: SearchableOption[] = React.useMemo(() => {
    const excelOptions: SearchableOption[] = excelUsers.map((eu: any) => ({
      value: `EXCEL::${eu.username}::${eu.name || eu.username}`,
      label: `${eu.name || eu.username} (@${eu.username})`,
      searchText: eu.username + " " + (eu.name || "")
    }));
    return excelOptions.sort((a, b) => a.label.localeCompare(b.label));
  }, []);

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
      const allQueries = await db.client_queries.toArray();
      allQueries.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
      setQueries(allQueries);
    } catch (err) {
      console.error("Failed to load support data", err);
    }
  };

  useEffect(() => { loadData(); }, [currentUser]);

  const handleLogQuery = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!clientNameInput.trim() || !queryProblem.trim()) {
      setErrorMsg("Enter a client name and describe the issue.");
      return;
    }
    try {
      let client_username = "UNKNOWN";
      let client_name = clientNameInput.trim();
      
      if (clientNameInput.startsWith("EXCEL::")) {
        const parts = clientNameInput.split("::");
        client_username = parts[1] || "UNKNOWN";
        const rawName = parts[2] || parts[1] || "Unknown Client";
        client_name = `${rawName} (@${client_username})`;
      }
      
      const newQuery: LocalClientQuery = {
        query_id: crypto.randomUUID(),
        client_username: client_username,
        client_name: client_name,
        client_problem: queryProblem.trim(),
        problem_status: "Open",
        assigned_to: currentUser?.user_id || null,
        created_at: new Date().toISOString(),
      };
      
      await transactionalMutation("client_queries", "INSERT", newQuery);

      setSuccessMsg("Query logged.");
      setTimeout(() => setSuccessMsg(null), 2500);
      setClientNameInput("");
      setQueryProblem("");
      await loadData();
    } catch (err) {
      setErrorMsg("Failed to log query.");
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
      await transactionalMutation("client_queries", "UPDATE", { query_id: resolveModalQuery.query_id, ...updates });
      await loadData();
      setResolveModalQuery(null);
      setResolutionNotes("");
    } catch (err) {
      setErrorMsg("Failed to resolve query.");
    }
  };

  const filteredQueries = queries.filter(q => {
    if (filterTab === "open") return q.problem_status !== "Resolved";
    if (filterTab === "resolved") return q.problem_status === "Resolved";
    return true;
  });

  const openCount = queries.filter(q => q.problem_status === "Open").length;
  const inProgCount = queries.filter(q => q.problem_status === "In Progress").length;
  const resolvedCount = queries.filter(q => q.problem_status === "Resolved").length;

  if (!hasSupport) {
    return (
      <Card className="max-w-md mx-auto mt-16 text-center space-y-4 p-8">
        <AlertCircle size={40} className="mx-auto text-[var(--status-danger)]" />
        <h3 className="text-base font-black text-[var(--text-primary)]">Access Restricted</h3>
        <p className="text-xs text-[var(--text-muted)] font-semibold">You don't have Support capabilities assigned.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-6 w-full max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Headphones size={24} className="text-[var(--brand-500)]" />
          <div>
            <h1 className="text-2xl font-black text-[var(--text-primary)]">Support & Operations</h1>
            <p className="text-xs text-[var(--text-muted)] font-bold uppercase tracking-wider">
              {isAdmin ? "All segments" : [hasDistSupport && "Distributors", hasRetSupport && "Retailers"].filter(Boolean).join(" & ")}
            </p>
          </div>
        </div>
        
        <Button
          size="sm"
          onClick={() => {
            if (currentUser) exportSupport(currentUser.user_id);
          }}
          icon={<Download size={14} />}
        >
          Export Support Data
        </Button>
      </div>

      {/* KPI summary row */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="p-4 bg-[var(--status-danger-soft)] border-[var(--status-danger)]/20">
          <p className="text-2xl font-black text-[var(--status-danger)]">{openCount}</p>
          <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mt-0.5">Open Queries</p>
        </Card>
        <Card className="p-4 bg-[var(--status-warning-soft)] border-[var(--status-warning)]/20">
          <p className="text-2xl font-black text-[var(--status-warning)]">{inProgCount}</p>
          <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mt-0.5">In Progress</p>
        </Card>
        <Card className="p-4 bg-[var(--status-success-soft)] border-[var(--status-success)]/20">
          <p className="text-2xl font-black text-[var(--status-success)]">{resolvedCount}</p>
          <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider mt-0.5">Resolved</p>
        </Card>
      </div>

      {successMsg && <div className="p-4 bg-[var(--status-success-soft)] border border-[var(--status-success)]/20 rounded-[var(--radius-lg)] text-[var(--status-success)] text-xs font-bold">✓ {successMsg}</div>}
      {errorMsg && <div className="p-4 bg-[var(--status-danger-soft)] border border-[var(--status-danger)]/20 rounded-[var(--radius-lg)] text-[var(--status-danger)] text-xs font-bold flex gap-2 items-center"><AlertCircle size={14}/>{errorMsg}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <Card className="lg:col-span-2 space-y-4">
          <h2 className="text-sm font-black text-[var(--text-primary)] flex items-center gap-2 border-b border-[var(--border-subtle)] pb-3">
            <MessageSquare size={16} className="text-[var(--brand-500)]" />
            Log Client Query
          </h2>

          <form onSubmit={handleLogQuery} className="space-y-4">
            <div>
              <label className="block text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest mb-1.5">
                Client Account
              </label>
              <SearchableSelect
                options={clientOptions}
                value={clientNameInput}
                onChange={setClientNameInput}
                placeholder="Type client name..."
                required
              />
            </div>

            <div>
              <label className="block text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest mb-1.5">
                Problem Description
              </label>
              <textarea
                required
                rows={3}
                value={queryProblem}
                onChange={e => setQueryProblem(e.target.value)}
                placeholder="Describe the issue reported by the client..."
                className="w-full bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-[var(--radius-md)] p-3 text-xs font-medium text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--brand-500)] focus:ring-2 focus:ring-[var(--brand-500)]/20 transition-all resize-none"
              />
            </div>

            <Button
              type="submit"
              className="w-full h-11"
            >
              Log Query
            </Button>
          </form>
        </Card>

        {/* Query Queue */}
        <Card className="lg:col-span-3 space-y-4 flex flex-col h-full max-h-[650px]">
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
            <h2 className="text-sm font-black text-[var(--text-primary)] flex items-center gap-2">
              <Clock size={16} className="text-[var(--brand-500)]" /> Query Queue
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={loadData}
              title="Refresh"
            >
              Refresh
            </Button>
          </div>

          <div className="flex gap-1.5 p-1 bg-[var(--surface-secondary)] rounded-[var(--radius-md)]">
            {(["open", "all", "resolved"] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setFilterTab(tab)}
                className={`flex-1 py-1.5 rounded-[var(--radius-sm)] text-xs font-bold transition-all cursor-pointer capitalize ${
                  filterTab === tab ? "bg-[var(--surface-primary)] text-[var(--brand-500)] shadow-xs" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                {tab === "open" ? `Open (${openCount})` : tab === "resolved" ? `Resolved (${resolvedCount})` : "All"}
              </button>
            ))}
          </div>

          <div className="space-y-3 overflow-y-auto pr-1 flex-1 pb-2">
            {filteredQueries.length === 0 && (
              <p className="text-xs italic text-[var(--text-muted)] text-center py-12 font-semibold">No queries in this view.</p>
            )}
            {filteredQueries.map(query => (
              <div
                key={query.query_id}
                className="p-3.5 bg-[var(--surface-secondary)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] space-y-2.5 hover:border-[var(--border-default)] transition-all"
              >
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider">
                      {query.client_name}
                    </p>
                    <p className="text-xs font-bold text-[var(--text-primary)] mt-0.5 leading-snug">
                      "{query.client_problem}"
                    </p>
                  </div>
                  <Chip variant={query.problem_status === "Resolved" ? "success" : "danger"} size="sm">
                    {query.problem_status}
                  </Chip>
                </div>

                <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)] font-semibold border-t border-[var(--border-subtle)] pt-2">
                  <span>{new Date(query.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  
                  {/* Single Action Completion Button: "Done" / "Resolve" */}
                  {query.problem_status !== "Resolved" && (
                    <Button
                      size="sm"
                      variant="success"
                      onClick={() => setResolveModalQuery(query)}
                    >
                      Resolve ✓
                    </Button>
                  )}
                  {query.problem_status === "Resolved" && (
                    <Chip variant="success" size="sm">
                      <CheckCircle2 size={10}/> Done
                    </Chip>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Resolve Modal */}
      {resolveModalQuery && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-[var(--z-modal)] flex items-center justify-center p-4">
          <Card className="w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-black text-[var(--text-primary)] flex items-center gap-2">
              <CheckCircle2 size={18} className="text-[var(--status-success)]" /> Mark Query Resolved
            </h3>
            <p className="text-xs font-semibold text-[var(--text-muted)]">
              {resolveModalQuery.client_name}
            </p>
            <form onSubmit={handleResolveSubmit} className="space-y-4">
              <div>
                <label className="block text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest mb-1.5">
                  Resolution Outcome
                </label>

                <div className="flex flex-wrap gap-1.5 mb-3">
                  {QUICK_REPLIES.map((reply) => (
                    <button
                      key={reply}
                      type="button"
                      onClick={() => setResolutionNotes(reply)}
                      className={`px-2.5 py-1 rounded-[var(--radius-round)] border text-[10px] font-bold cursor-pointer transition-all ${
                        resolutionNotes === reply
                          ? "bg-[var(--status-success-soft)] border-[var(--status-success)]/30 text-[var(--status-success)]"
                          : "bg-[var(--surface-primary)] border-[var(--border-default)] text-[var(--text-secondary)] hover:border-[var(--brand-500)]"
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
                  placeholder="Resolution details..."
                  className="w-full bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-[var(--radius-md)] p-2.5 text-xs font-semibold text-[var(--text-primary)] focus:outline-none focus:border-[var(--status-success)] focus:ring-2 focus:ring-[var(--status-success)]/20 transition-all"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="flex-1"
                  onClick={() => { setResolveModalQuery(null); setResolutionNotes(""); }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="success"
                  disabled={!resolutionNotes.trim()}
                  className="flex-1"
                >
                  Confirm
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
