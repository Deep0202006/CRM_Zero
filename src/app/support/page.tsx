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
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { PageHeader } from "@/components/ui/PageHeader";
import { MetricCard } from "@/components/ui/MetricCard";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/EmptyState";
import excelUsers from "@/lib/excel_users.json";
import { buildCanonicalClientOptions } from "@/lib/clientOptions";

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
    return buildCanonicalClientOptions(excelUsers as Array<{ username: string; name?: string }>);
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
      <section className="access-state" aria-labelledby="support-access-title">
        <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-[var(--radius-lg)] bg-[var(--status-danger-soft)] text-[var(--status-danger)]"><AlertCircle size={22} /></span>
        <h1 id="support-access-title" className="text-lg font-semibold">Support workspace is restricted</h1>
        <p className="mx-auto mt-2 max-w-sm text-[13px] leading-5 text-[var(--text-muted)]">Your account is not assigned distributor or retailer support access.</p>
      </section>
    );
  }

  const supportScope = isAdmin ? "All client segments" : [hasDistSupport && "Distributor", hasRetSupport && "Retailer"].filter(Boolean).join(" and ");

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Service operations"
        icon={<Headphones size={18} />}
        title="Client support queue"
        description="Capture issues with enough context, focus the unresolved queue, and document every resolution outcome."
        meta={<Chip variant="neutral" size="sm">Scope · {supportScope}</Chip>}
        actions={
          <Button size="sm" variant="outline" onClick={() => currentUser && exportSupport(currentUser.user_id)} icon={<Download size={14} />}>
            Export support data
          </Button>
        }
      />

      <div className="metric-grid">
        <MetricCard label="Open issues" value={openCount} icon={<AlertCircle size={17} />} tone="danger" note="New issues awaiting action" />
        <MetricCard label="In progress" value={inProgCount} icon={<Clock size={17} />} tone="warning" note="Work currently underway" />
        <MetricCard label="Resolved" value={resolvedCount} icon={<CheckCircle2 size={17} />} tone="success" note="Queries with documented outcomes" />
        <MetricCard label="Total history" value={queries.length} icon={<MessageSquare size={17} />} tone="neutral" note="All locally available service records" />
      </div>

      {successMsg && <div className="alert-panel alert-panel--success" role="status"><CheckCircle2 size={16} className="mt-0.5 shrink-0" /><span>{successMsg}</span></div>}
      {errorMsg && <div className="alert-panel alert-panel--danger" role="alert"><AlertCircle size={16} className="mt-0.5 shrink-0" /><span>{errorMsg}</span></div>}

      <div className="workspace-split">
        <section className="surface-panel overflow-hidden" aria-labelledby="new-support-query-title">
          <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-5">
            <p className="section-kicker">New request</p>
            <h2 id="new-support-query-title" className="mt-1 section-title">Log a client issue</h2>
            <p className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">Use specific language so another team member can continue the resolution without repeating discovery.</p>
          </div>
          <form onSubmit={handleLogQuery} className="space-y-5 p-5 sm:p-6">
            <div>
              <label className="field-label">Client account</label>
              <SearchableSelect options={clientOptions} value={clientNameInput} onChange={setClientNameInput} placeholder="Search a client account" required />
            </div>
            <div>
              <label htmlFor="support-problem" className="field-label">Problem description</label>
              <textarea id="support-problem" required rows={5} value={queryProblem} onChange={(event) => setQueryProblem(event.target.value)} placeholder="What happened, what the client expected, and what has already been tried?" className="field-control resize-y" />
            </div>
            <div className="flex justify-end border-t border-[var(--border-subtle)] pt-5">
              <Button type="submit" icon={<MessageSquare size={15} />} disabled={!clientNameInput.trim() || !queryProblem.trim()}>Add to support queue</Button>
            </div>
          </form>
        </section>

        <section className="surface-panel min-h-[560px] overflow-hidden" aria-labelledby="support-queue-title">
          <div className="flex flex-col gap-4 border-b border-[var(--border-subtle)] p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="section-kicker">Resolution workspace</p>
              <h2 id="support-queue-title" className="mt-1 section-title">Query queue</h2>
            </div>
            <div className="flex items-center gap-2">
              <div className="segmented-control" aria-label="Support queue view">
                {(["open", "all", "resolved"] as const).map((tab) => (
                  <button key={tab} type="button" aria-pressed={filterTab === tab} onClick={() => setFilterTab(tab)}>
                    {tab === "open" ? `Open ${openCount}` : tab === "resolved" ? `Resolved ${resolvedCount}` : `All ${queries.length}`}
                  </button>
                ))}
              </div>
              <Button variant="ghost" size="sm" onClick={loadData}>Refresh</Button>
            </div>
          </div>

          <div className="max-h-[650px] overflow-y-auto p-4 sm:p-5">
            {filteredQueries.length === 0 ? (
              <EmptyState icon={<Headphones size={21} />} title="No queries in this view" description="Change the queue filter or add a new client issue." />
            ) : (
              <div className="space-y-3">
                {filteredQueries.map((query) => {
                  const resolved = query.problem_status === "Resolved";
                  const statusVariant = resolved ? "success" : query.problem_status === "In Progress" ? "warning" : "danger";
                  return (
                    <article key={query.query_id} className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--surface-primary)] p-4 transition hover:border-[var(--border-default)] hover:shadow-[var(--shadow-raised)]">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <p className="truncate text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--text-muted)]">{query.client_name}</p>
                          <p className="mt-2 text-[13px] font-semibold leading-5 text-[var(--text-primary)]">{query.client_problem}</p>
                        </div>
                        <Chip variant={statusVariant} size="sm" dot>{query.problem_status}</Chip>
                      </div>
                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-3">
                        <span className="text-[11px] text-[var(--text-muted)]">Logged {new Date(query.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                        {resolved ? (
                          <Chip variant="success" size="sm"><CheckCircle2 size={11} /> Outcome recorded</Chip>
                        ) : (
                          <Button size="sm" variant="success" onClick={() => setResolveModalQuery(query)} icon={<CheckCircle2 size={13} />}>Resolve issue</Button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>

      <Modal
        open={Boolean(resolveModalQuery)}
        onClose={() => { setResolveModalQuery(null); setResolutionNotes(""); }}
        title="Document the resolution"
        description={resolveModalQuery ? `${resolveModalQuery.client_name} · ${resolveModalQuery.client_problem}` : undefined}
        size="md"
        footer={
          <>
            <Button variant="secondary" onClick={() => { setResolveModalQuery(null); setResolutionNotes(""); }}>Cancel</Button>
            <Button type="submit" form="resolve-support-form" variant="success" disabled={!resolutionNotes.trim()}>Mark resolved</Button>
          </>
        }
      >
        <form id="resolve-support-form" onSubmit={handleResolveSubmit} className="space-y-5">
          <fieldset>
            <legend className="field-label">Common outcomes</legend>
            <div className="flex flex-wrap gap-2">
              {QUICK_REPLIES.map((reply) => (
                <button key={reply} type="button" onClick={() => setResolutionNotes(reply)} aria-pressed={resolutionNotes === reply} className={`min-h-8 rounded-[var(--radius-round)] border px-3 text-[11px] font-semibold transition ${resolutionNotes === reply ? "border-[var(--status-success)] bg-[var(--status-success-soft)] text-[var(--status-success)]" : "border-[var(--border-default)] bg-[var(--surface-primary)] text-[var(--text-secondary)] hover:border-[var(--brand-500)]"}`}>
                  {reply}
                </button>
              ))}
            </div>
          </fieldset>
          <div>
            <label htmlFor="resolution-notes" className="field-label">Resolution notes</label>
            <textarea id="resolution-notes" required rows={4} value={resolutionNotes} onChange={(event) => setResolutionNotes(event.target.value)} placeholder="Describe what fixed the issue and anything the next agent should know." className="field-control resize-y" />
          </div>
        </form>
      </Modal>
    </div>
  );
}
