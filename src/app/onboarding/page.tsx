"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronRight, ListPlus, PhoneCall, Plus, RefreshCw } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { db, type LocalCallLog } from "@/lib/db";
import { createExplicitPipelineTask } from "@/lib/pipeline/taskAction";
import { transitionLead, retryPendingPipelineTransitions } from "@/lib/leadStageService";
import { stagesForSegment, type PipelineStage } from "@/lib/pipelineStages";
import { getEmployeeTransitionActions, type PipelineLeadView, type PipelineSegment } from "@/lib/pipeline/contract";
import { fetchPipelineSnapshot, type PipelinePendingState } from "@/lib/pipeline/repository";
import { createPipelineLead } from "@/lib/pipeline/createLeadService";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { ContextRail } from "@/components/workspace/ContextRail";

const STAGE_VARIANTS: Record<PipelineStage, "neutral" | "info" | "warning" | "danger" | "pending" | "success" | "brand"> = {
  New: "neutral", Contacted: "info", Interested: "warning", "Not Interested": "danger",
  Registration: "pending", Installation: "success", Payment: "brand", Converted: "success", "Renewal Due": "warning",
};

type LeadContextBrief = {
  lead: { lead_id: string };
  stage_age_days: number;
  transitions: Array<{ expected_stage: string; target_stage: string; confirmed_at: string }>;
  next_task: { title: string; due_date: string } | null;
  overdue_tasks: Array<{ task_id: string }>;
  recent_tasks: Array<{ task_id: string }>;
  latest_call: { outcome: string; timestamp: string } | null;
  recent_calls: Array<{ log_id: string }>;
};

export default function OnboardingPage() {
  const { currentUser, isAdmin } = useAuth();
  const segments = useMemo<PipelineSegment[]>(() => ["Retailer", "Distributor"], []);
  const [segmentTab, setSegmentTab] = useState<PipelineSegment>("Retailer");
  const [leads, setLeads] = useState<PipelineLeadView[]>([]);
  const [pending, setPending] = useState(new Map<string, PipelinePendingState>());
  const [authorityState, setAuthorityState] = useState<"server" | "offline" | "error">("server");
  const [view, setView] = useState<"board" | "list">("board");
  const contextGeneration = useRef(0);
  const contextRequest = useRef<AbortController | null>(null);
  const contextDeadline = useRef<ReturnType<typeof setTimeout> | null>(null);
  const leadTrigger = useRef<HTMLElement | null>(null);
  const [selectedLead, setSelectedLead] = useState<PipelineLeadView | null>(null);
  const [callLogs, setCallLogs] = useState<LocalCallLog[]>([]);
  const [leadContext, setLeadContext] = useState<LeadContextBrief | null>(null);
  const [leadContextError, setLeadContextError] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string; existing?: PipelineLeadView } | null>(null);
  const [transitioning, setTransitioning] = useState<string | null>(null);
  const [creatingTask, setCreatingTask] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [newLead, setNewLead] = useState({ business: "", contact: "", phone: "", area: "", source: "Cold Call", sourceOther: "" });
  const refreshInFlight = useRef<{ key: string; promise: Promise<void> } | null>(null);
  const hiddenRefreshPending = useRef(false);
  const currentRefreshKey = `${page}:${segmentTab}:${currentUser?.user_id ?? "anonymous"}`;
  const currentRefreshKeyRef = useRef(currentRefreshKey);
  useEffect(() => { currentRefreshKeyRef.current = currentRefreshKey; }, [currentRefreshKey]);

  const refresh = useCallback(async () => {
    if (!currentUser) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") { hiddenRefreshPending.current = true; return; }
    const key = `${page}:${segmentTab}:${currentUser.user_id}`;
    if (refreshInFlight.current?.key === key) return refreshInFlight.current.promise;
    const promise = (async () => {
      const snapshot = await fetchPipelineSnapshot(segments, currentUser.user_id, page, segmentTab);
      if (currentRefreshKeyRef.current !== key) return;
      setLeads(snapshot.leads); setPending(snapshot.pending); setAuthorityState(snapshot.authorityState);
      setTotal(snapshot.total); setHasMore(snapshot.hasMore);
      setSelectedLead((selected) => selected ? snapshot.leads.find((lead) => lead.lead_id === selected.lead_id) ?? selected : null);
    })();
    refreshInFlight.current = { key, promise };
    try { await promise; } finally { if (refreshInFlight.current?.promise === promise) refreshInFlight.current = null; }
  }, [currentUser, page, segmentTab, segments]);

  useEffect(() => {
    if (currentUser && navigator.onLine) void retryPendingPipelineTransitions(currentUser.user_id).then(refresh);
    else void refresh();
    const reconcile = () => { if (document.visibilityState === "hidden") { hiddenRefreshPending.current = true; return; } if (currentUser) void retryPendingPipelineTransitions(currentUser.user_id).then(refresh); };
    const visible = () => { if (document.visibilityState === "visible" && hiddenRefreshPending.current) { hiddenRefreshPending.current = false; reconcile(); } };
    window.addEventListener("online", reconcile); document.addEventListener("visibilitychange", visible);
    return () => { window.removeEventListener("online", reconcile); document.removeEventListener("visibilitychange", visible); };
  }, [currentUser, refresh]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const channel = supabase.channel(`pipeline-authority-refresh:${segmentTab}`).on("postgres_changes", { event: "*", schema: "public", table: "leads", filter: `segment_type=eq.${segmentTab}` }, () => { if (document.visibilityState === "hidden") hiddenRefreshPending.current = true; else void refresh(); }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refresh, segmentTab]);

  const closeLead = useCallback(() => {
    contextGeneration.current += 1;
    contextRequest.current?.abort();
    if (contextDeadline.current) clearTimeout(contextDeadline.current);
    setSelectedLead(null); setCallLogs([]); setLeadContext(null); setLeadContextError(false);
  }, []);
  useEffect(() => { closeLead(); return () => { contextGeneration.current += 1; contextRequest.current?.abort(); if (contextDeadline.current) clearTimeout(contextDeadline.current); }; }, [currentUser?.user_id, isAdmin, closeLead]);

  const openLead = async (lead: PipelineLeadView) => {
    const generation = ++contextGeneration.current;
    contextRequest.current?.abort();
    if (contextDeadline.current) clearTimeout(contextDeadline.current);
    const controller = new AbortController();
    contextRequest.current = controller;
    const current = () => contextGeneration.current === generation && !controller.signal.aborted;
    if (document.activeElement instanceof HTMLElement) leadTrigger.current = document.activeElement;
    setSelectedLead(lead); setCallLogs([]); setLeadContext(null); setLeadContextError(false);
    const deadline = setTimeout(() => {
      if (!current()) return;
      contextGeneration.current += 1;
      controller.abort();
      setLeadContextError(true);
    }, 12_000);
    contextDeadline.current = deadline;
    try {
      const logs = await db.call_logs.where("lead_id").equals(lead.lead_id).and((log) => isAdmin || log.user_id === currentUser?.user_id).toArray();
      if (!current()) return;
      setCallLogs(logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp)));
      if (!navigator.onLine) return;
      const { data } = await supabase.auth.getSession();
      if (!current()) return;
      if (!data.session) throw new Error("AUTH_REQUIRED");
      const response = await fetch(`/api/pipeline/leads/${lead.lead_id}/context`, { headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("CONTEXT_FAILED");
      const result = await response.json() as LeadContextBrief;
      if (!current()) return;
      if (result.lead?.lead_id !== lead.lead_id) throw new Error("CONTEXT_IDENTITY_MISMATCH");
      setLeadContext(result);
    } catch { if (current()) setLeadContextError(true); }
    finally { clearTimeout(deadline); }
  };

  const createLeadTask = async (lead: PipelineLeadView) => {
    if (!currentUser || creatingTask || lead.assigned_to !== currentUser.user_id) return;
    setCreatingTask(lead.lead_id);
    try {
      const { result } = await createExplicitPipelineTask({ userId: currentUser.user_id, leadId: lead.lead_id, businessName: lead.business_name });
      setMessage({ tone: "success", text: result === "created" ? "Exact Lead task saved for sync." : "This exact Pipeline task is already saved." });
    } catch { setMessage({ tone: "danger", text: "Task could not be saved. Try again; retries keep the same exact Task identity." }); }
    finally { setCreatingTask(null); }
  };

  const moveLead = async (lead: PipelineLeadView, target: PipelineStage) => {
    if (!currentUser || lead.assigned_to !== currentUser.user_id) return;
    setTransitioning(lead.lead_id); setMessage(null);
    try {
      const result = await transitionLead(lead.lead_id, target, lead.status, currentUser.user_id, lead.assigned_to, lead.segment_type);
      if (result.status === "confirmed") setMessage({ tone: "success", text: `Lead moved to ${result.lead.status}.` });
      else if (result.status === "pending") setMessage({ tone: "success", text: `Move to ${target} is saved and pending confirmation.` });
      else setMessage({ tone: "danger", text: result.message });
      await refresh();
    } catch { setMessage({ tone: "danger", text: "This stage move is not permitted." }); }
    finally { setTransitioning(null); }
  };

  const createLead = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!currentUser || !newLead.business.trim() || !newLead.contact.trim() || !newLead.phone.trim()) return;
    setMessage(null);
    const result = await createPipelineLead({
      businessName: newLead.business,
      contactPerson: newLead.contact,
      phone: newLead.phone,
      segment: segmentTab,
      source: newLead.source === "Other" ? newLead.sourceOther.trim() || "Other" : newLead.source,
      area: newLead.area,
    }, currentUser.user_id);
    if (result.status === "duplicate") {
      setShowAddModal(false);
      setSegmentTab(result.existing.segment_type);
      setMessage({ tone: "danger", text: `Lead already exists — ${result.existing.status}.`, existing: result.existing });
      return;
    }
    if (result.status === "rejected") {
      setMessage({ tone: "danger", text: result.message });
      return;
    }
    setNewLead({ business: "", contact: "", phone: "", area: "", source: "Cold Call", sourceOther: "" });
    setShowAddModal(false);
    setMessage({ tone: "success", text: result.status === "confirmed" ? "Lead created." : "Lead creation is saved and pending confirmation." });
    await refresh();
  };

  const visibleLeads = leads.filter((lead) => lead.segment_type === segmentTab && `${lead.business_name} ${lead.contact_person}`.toLowerCase().includes(searchQuery.toLowerCase()));
  const reviewCount = [...pending.values()].filter((state) => state.kind !== "pending").length;
  const selectedPrimary = selectedLead ? getEmployeeTransitionActions(selectedLead.status, selectedLead.segment_type)[0] : undefined;

  return <div className="app-page relative crm-workspace">
    <header className="workspace-heading"><div><h1>Pipeline</h1><p>Server-confirmed leads · Assigned-owner stage actions</p></div><Button onClick={() => setShowAddModal(true)} icon={<Plus size={15} />}>New lead</Button></header>
    {authorityState === "offline" && <div role="status" className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--status-warning)]/30 bg-[var(--status-warning-soft)] p-3 text-[12px]"><span>Offline. Showing durable local Pipeline state until the server is reachable.</span><Button size="sm" variant="outline" onClick={refresh} icon={<RefreshCw size={13} />}>Retry</Button></div>}
    {authorityState === "error" && <div role="alert" className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--status-danger)]/30 bg-[var(--status-danger-soft)] p-3 text-[12px] text-[var(--status-danger)]"><span>Unable to load the authoritative Pipeline. Local records may be incomplete.</span><Button size="sm" variant="outline" onClick={refresh} icon={<RefreshCw size={13} />}>Retry</Button></div>}
    {reviewCount > 0 && <div role="status" className="rounded-[var(--radius-md)] border border-[var(--status-warning)]/30 bg-[var(--status-warning-soft)] p-3 text-[12px]">{reviewCount} saved Pipeline move{reviewCount === 1 ? "" : "s"} need review. Server-confirmed stages remain authoritative.</div>}
    {message && <div className={`flex items-center justify-between gap-3 rounded-[var(--radius-md)] border p-3 text-[12px] ${message.tone === "success" ? "text-[var(--status-success)]" : "text-[var(--status-danger)]"}`}><span className="flex items-center gap-2">{message.tone === "success" ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}{message.text}</span>{message.existing && <Button size="sm" variant="outline" onClick={() => openLead(message.existing!)}>Open existing lead</Button>}</div>}
    <section className="flex flex-wrap items-center gap-3" aria-label="Pipeline controls">
      <div className="segmented-control" aria-label="Pipeline segment">{segments.map((segment) => <button key={segment} type="button" aria-pressed={segmentTab === segment} onClick={() => { setSegmentTab(segment); setPage(1); closeLead(); }}>{segment}s</button>)}</div>
      <label className="min-w-full flex-1 sm:min-w-48"><span className="sr-only">Search by business or contact</span><input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search business or contact" className="field-control" /></label>
      <div className="segmented-control" aria-label="Pipeline layout">{(["board", "list"] as const).map((mode) => <button key={mode} type="button" aria-pressed={view === mode} onClick={() => setView(mode)}>{mode === "board" ? "Board" : "List"}</button>)}</div>
    </section>
    <p className="text-xs text-[var(--text-secondary)]">{visibleLeads.length} search matches on loaded page {page} · {leads.length} of {total} segment leads. Stage counts below cover this loaded page only.</p>
    <div className="workspace-columns">
    <div className="min-w-0">
    {view === "board" && <nav aria-label="Stage navigator" className="mb-3 flex gap-2 overflow-x-auto pb-1">{stagesForSegment(segmentTab).map((stage) => <button className="shrink-0 rounded border border-[var(--border-subtle)] px-3 text-xs" key={stage} onClick={() => document.querySelector<HTMLElement>(`[data-stage="${stage}"]`)?.scrollIntoView({ block: "nearest", inline: "start", behavior: "instant" })}>{stage} · {visibleLeads.filter((lead) => lead.status === stage).length}</button>)}</nav>}
    {view === "list" ? <section className="workspace-register" data-workspace-register tabIndex={-1} aria-label="Pipeline lead list"><ol className="divide-y divide-[var(--border-subtle)]">{visibleLeads.map((lead) => <li key={lead.lead_id} className="workspace-task-row"><button className="min-w-0 flex-1 text-left text-sm" onClick={() => openLead(lead)}><strong className="block">{lead.business_name}</strong><span className="block text-xs text-[var(--text-secondary)]">{lead.contact_person} · {lead.phone} · Owner: {lead.owner_name}</span></button><Chip size="sm" variant={STAGE_VARIANTS[lead.status]}>{lead.status}</Chip>{pending.get(lead.lead_id) && <span className="text-xs">Saved move: {pending.get(lead.lead_id)?.kind}</span>}{lead.assigned_to === currentUser?.user_id && getEmployeeTransitionActions(lead.status, lead.segment_type).slice(0, 1).map((action) => <Button key={action.to} size="sm" isLoading={transitioning === lead.lead_id} onClick={() => moveLead(lead, action.to)}>Move to {action.to}</Button>)}</li>)}</ol>{!visibleLeads.length && <EmptyState title="No matching leads" description="Clear the search or choose another segment." />}</section> : (
    <section
      className="pipeline-board-shell min-w-0 w-full overflow-x-scroll overflow-y-hidden overscroll-x-contain rounded-[var(--radius-lg)] pb-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-400)]"
      style={{ height: "clamp(26rem, calc(100dvh - 19rem), 46rem)", scrollbarGutter: "stable both-edges" }}
      data-workspace-register
      aria-label={`${segmentTab} pipeline board. Scroll horizontally to reach all ${stagesForSegment(segmentTab).length} stages.`}
      tabIndex={0}
    ><div className="pipeline-board-track flex h-full min-w-max gap-3 pr-2">
      {stagesForSegment(segmentTab).map((stage) => { const stageLeads = visibleLeads.filter((lead) => lead.status === stage); return <article key={stage} data-stage={stage} className="pipeline-stage-column flex h-full min-h-0 w-[292px] flex-none flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--surface-secondary)]">
        <header className="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-3.5 py-3"><div><p className="text-[12px] font-semibold">{stage}</p><p className="text-[10px] text-[var(--text-muted)]">{stageLeads.length} in this stage</p></div><Chip variant={STAGE_VARIANTS[stage]} size="sm">{stageLeads.length}</Chip></header>
        <div className="pipeline-stage-leads min-h-0 flex-1 space-y-2 overflow-x-hidden overflow-y-auto p-2.5">{stageLeads.map((lead) => { const state = pending.get(lead.lead_id); const actions = getEmployeeTransitionActions(lead.status, lead.segment_type); const isOwner = lead.assigned_to === currentUser?.user_id; return <div key={lead.lead_id} className="min-w-0 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface-primary)] p-3 ">
          <button type="button" onClick={() => openLead(lead)} className="w-full text-left"><span className="block whitespace-normal break-words text-sm font-semibold leading-5">{lead.business_name}</span><span className="mt-1 block whitespace-normal break-words text-xs text-[var(--text-muted)]">{lead.contact_person} · {lead.phone}</span><span className="mt-2 block whitespace-normal break-words text-xs text-[var(--text-muted)]">Owner: {lead.owner_name}</span></button>
          {state?.kind === "pending" && <p className="mt-2 text-[10px] font-semibold text-[var(--status-warning)]">{`Pending → ${state.target}`}</p>}
          {isOwner && actions.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{actions.map((action, index) => <Button key={action.to} size="sm" variant={index === 0 ? "primary" : "outline"} isLoading={transitioning === lead.lead_id} onClick={() => moveLead(lead, action.to)}>{`Move to ${action.to}`}</Button>)}</div>}
        </div>; })}{stageLeads.length === 0 && <EmptyState title="Stage is clear" description="No leads currently in this stage." className="min-h-[190px] border-0 bg-transparent" />}</div>
      </article>; })}
    </div></section>)}
    <div className="mt-3 flex items-center justify-between gap-3"><p className="text-xs text-[var(--text-muted)]">Page {page} · showing {leads.length} of {total}</p><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</Button><Button size="sm" variant="outline" disabled={!hasMore} onClick={() => setPage((value) => value + 1)}>Next</Button></div></div>
    </div>
    <ContextRail open={Boolean(selectedLead)} title={selectedLead?.business_name || "Lead context"} description={selectedLead ? `${selectedLead.contact_person} · ${selectedLead.phone}` : "Select a lead"} onClose={closeLead} returnFocus={leadTrigger}>
      {selectedLead && <>
        <p><Chip variant={STAGE_VARIANTS[selectedLead.status]}>{selectedLead.status}</Chip> · {selectedLead.segment_type}</p>
        <p>Owner: {selectedLead.owner_name}</p><p>Source: {selectedLead.lead_source || "Not recorded"}</p>
        <p>{selectedLead.area || "Area not recorded"}</p>
        {leadContextError ? <div role="alert"><p>Authoritative context unavailable. No linked-work counts are inferred.</p><Button size="sm" variant="outline" onClick={() => openLead(selectedLead)}>Retry context</Button></div> : !leadContext ? <p role="status">Context loading or offline. {callLogs.length > 0 ? `${callLogs.length} authorized local call records retained.` : "Linked work is not yet available."}</p> : <>
          <dl className="space-y-3">
            <div><dt>Current stage age</dt><dd>{leadContext.stage_age_days} days</dd></div>
            <div><dt>Latest confirmed transition</dt><dd>{leadContext.transitions[0] ? `${leadContext.transitions[0].expected_stage} → ${leadContext.transitions[0].target_stage}` : "None in retained context"}</dd></div>
            <div><dt>Next linked task</dt><dd>{leadContext.next_task ? `${leadContext.next_task.title} · ${leadContext.next_task.due_date}` : "None in the authorized context"}</dd></div>
            <div><dt>Overdue tasks in context</dt><dd>{leadContext.overdue_tasks.length}</dd></div>
            <div><dt>Latest linked call</dt><dd>{leadContext.latest_call ? `${leadContext.latest_call.outcome} · ${new Date(leadContext.latest_call.timestamp).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST` : "None in retained context"}</dd></div>
          </dl><p className="text-xs text-[var(--text-secondary)]">Bounded authorized context: up to 20 tasks, 10 calls and 20 transitions. Not an all-time activity total.</p>
        </>}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" icon={<PhoneCall size={15} />} onClick={() => { window.location.href = `/call-logs?lead_id=${encodeURIComponent(selectedLead.lead_id)}&lead_name=${encodeURIComponent(selectedLead.business_name)}`; }}>Log Call</Button>
          {selectedLead.assigned_to === currentUser?.user_id && <Button size="sm" variant="outline" icon={<ListPlus size={15} />} disabled={Boolean(creatingTask)} onClick={() => void createLeadTask(selectedLead)}>{creatingTask === selectedLead.lead_id ? "Saving Task" : "Create Task"}</Button>}
          {selectedPrimary && selectedLead.assigned_to === currentUser?.user_id && <Button size="sm" icon={<ChevronRight size={15} />} isLoading={transitioning === selectedLead.lead_id} onClick={() => moveLead(selectedLead, selectedPrimary.to)}>Move to {selectedPrimary.to}</Button>}
        </div>
      </>}
    </ContextRail>
    </div>
    <Modal open={showAddModal} onClose={() => setShowAddModal(false)} title="Create a new lead" description="Pipeline checks every historical stage, including Converted, before creating the lead." size="sm"><form onSubmit={createLead} className="space-y-4">
      <Input label="Business name" required value={newLead.business} onChange={(e) => setNewLead({ ...newLead, business: e.target.value })} /><Input label="Contact person" required value={newLead.contact} onChange={(e) => setNewLead({ ...newLead, contact: e.target.value })} /><Input label="Phone number" required value={newLead.phone} onChange={(e) => setNewLead({ ...newLead, phone: e.target.value })} /><Input label="Area or city" value={newLead.area} onChange={(e) => setNewLead({ ...newLead, area: e.target.value })} />
      <label className="space-y-1.5"><span className="field-label">Lead source</span><select className="field-control" value={newLead.source} onChange={(e) => setNewLead({ ...newLead, source: e.target.value })}><option>Cold Call</option><option>Referral</option><option>Website</option><option>Field Visit</option><option>Other</option></select></label>
      {newLead.source === "Other" && <Input label="Other lead source" required value={newLead.sourceOther} onChange={(e) => setNewLead({ ...newLead, sourceOther: e.target.value })} />}
      <div className="flex justify-end gap-2"><Button variant="outline" type="button" onClick={() => setShowAddModal(false)}>Cancel</Button><Button type="submit">Create lead</Button></div>
    </form></Modal>
  </div>;
}
