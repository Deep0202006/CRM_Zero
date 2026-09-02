"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronRight, Layers, ListPlus, PhoneCall, Plus, RefreshCw, Search } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { db, transactionalMutation, type LocalCallLog } from "@/lib/db";
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
import { PageHeader } from "@/components/ui/PageHeader";
import { RecordInspector, type RecordInspectorData } from "@/components/RecordInspector";

const STAGE_VARIANTS: Record<PipelineStage, "neutral" | "info" | "warning" | "danger" | "pending" | "success" | "brand"> = {
  New: "neutral", Contacted: "info", Interested: "warning", "Not Interested": "danger",
  Registration: "pending", Installation: "success", Payment: "brand", Converted: "success", "Renewal Due": "warning",
};

type LeadContextBrief = {
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
  const [selectedLead, setSelectedLead] = useState<PipelineLeadView | null>(null);
  const [callLogs, setCallLogs] = useState<LocalCallLog[]>([]);
  const [leadContext, setLeadContext] = useState<LeadContextBrief | null>(null);
  const [leadContextError, setLeadContextError] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string; existing?: PipelineLeadView } | null>(null);
  const [transitioning, setTransitioning] = useState<string | null>(null);
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

  const openLead = async (lead: PipelineLeadView) => {
    setSelectedLead(lead);
    setLeadContext(null); setLeadContextError(false);
    const logs = await db.call_logs.where("lead_id").equals(lead.lead_id).and((log) => isAdmin || log.user_id === currentUser?.user_id).toArray();
    setCallLogs(logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp)));
    if (!navigator.onLine) return;
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) throw new Error("AUTH_REQUIRED");
      const response = await fetch(`/api/pipeline/leads/${lead.lead_id}/context`, { headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: "no-store" });
      if (!response.ok) throw new Error("CONTEXT_FAILED");
      setLeadContext(await response.json() as LeadContextBrief);
    } catch { setLeadContextError(true); }
  };

  const createLeadTask = async (lead: PipelineLeadView) => {
    if (!currentUser || lead.assigned_to !== currentUser.user_id) return;
    const title = `Follow up: ${lead.business_name}`;
    const duplicate = await db.tasks.where("assigned_to").equals(currentUser.user_id).filter((task) => task.is_active !== false && task.status !== "Completed" && task.related_lead_id === lead.lead_id && task.title === title).first();
    if (duplicate) { setMessage({ tone: "danger", text: "An active exact Lead task already exists." }); return; }
    const createdAt = new Date().toISOString();
    await transactionalMutation("tasks", "INSERT", { task_id: crypto.randomUUID(), assigned_to: currentUser.user_id, assigned_by: currentUser.user_id, title, description: `Explicit Pipeline follow-up for ${lead.business_name}.`, priority: "Medium", status: "Pending", source: "manual", template_id: null, related_lead_id: lead.lead_id, due_date: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()), started_at: null, completed_at: null, proof_note: null, proof_photo_url: null, created_at: createdAt, is_active: true });
    setMessage({ tone: "success", text: "Exact Lead task saved for sync." });
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
  const inspectorData: RecordInspectorData | null = selectedLead ? {
    id: selectedLead.lead_id, title: selectedLead.business_name, subtitle: `${selectedLead.contact_person} · ${selectedLead.phone}`, type: "lead",
    status: selectedLead.status, statusVariant: STAGE_VARIANTS[selectedLead.status], phone: selectedLead.phone, address: selectedLead.area ?? undefined,
    owner: selectedLead.owner_name, createdAt: selectedLead.created_at, details: { Segment: selectedLead.segment_type, Source: selectedLead.lead_source || "N/A", Stage_age_days: leadContext?.stage_age_days ?? "Loading", Last_transition: leadContext?.transitions[0] ? `${leadContext.transitions[0].expected_stage} → ${leadContext.transitions[0].target_stage}` : "No confirmed transition", Next_task: leadContext?.next_task ? `${leadContext.next_task.title} · ${leadContext.next_task.due_date}` : "No exact linked task", Overdue_tasks: leadContext?.overdue_tasks.length ?? 0, Latest_call: leadContext?.latest_call ? `${leadContext.latest_call.outcome} · ${new Date(leadContext.latest_call.timestamp).toLocaleDateString()}` : "No exact linked call", Recent_tasks: leadContext?.recent_tasks.length ?? 0, Recent_calls: leadContext?.recent_calls.length ?? callLogs.length, Context_status: leadContextError ? "Authoritative context unavailable" : leadContext ? "Server-authoritative" : "Loading or offline" },
  } : null;
  const selectedPrimary = selectedLead ? getEmployeeTransitionActions(selectedLead.status, selectedLead.segment_type)[0] : undefined;

  return <div className="app-page relative">
    <PageHeader eyebrow="Sales onboarding" icon={<Layers size={16} />} title="Lead conversion pipeline" description="Server-confirmed leads with simple, assigned-owner stage actions."
      actions={<><div className="segmented-control">{segments.map((segment) => <button key={segment} type="button" aria-pressed={segmentTab === segment} onClick={() => { setSegmentTab(segment); setPage(1); }}>{segment}s</button>)}</div><Button onClick={() => setShowAddModal(true)} icon={<Plus size={15} />}>New lead</Button></>}
      meta={<><Chip variant="brand" size="sm" dot>{visibleLeads.length} visible leads</Chip><Chip variant="neutral" size="sm">{stagesForSegment(segmentTab).length} stages</Chip></>} />
    {authorityState === "offline" && <div role="status" className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--status-warning)]/30 bg-[var(--status-warning-soft)] p-3 text-[12px]"><span>Offline. Showing durable local Pipeline state until the server is reachable.</span><Button size="sm" variant="outline" onClick={refresh} icon={<RefreshCw size={13} />}>Retry</Button></div>}
    {authorityState === "error" && <div role="alert" className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--status-danger)]/30 bg-[var(--status-danger-soft)] p-3 text-[12px] text-[var(--status-danger)]"><span>Unable to load the authoritative Pipeline. Local records may be incomplete.</span><Button size="sm" variant="outline" onClick={refresh} icon={<RefreshCw size={13} />}>Retry</Button></div>}
    {reviewCount > 0 && <div role="status" className="rounded-[var(--radius-md)] border border-[var(--status-warning)]/30 bg-[var(--status-warning-soft)] p-3 text-[12px]">{reviewCount} saved Pipeline move{reviewCount === 1 ? "" : "s"} need review. Server-confirmed stages remain authoritative.</div>}
    {message && <div className={`flex items-center justify-between gap-3 rounded-[var(--radius-md)] border p-3 text-[12px] ${message.tone === "success" ? "text-[var(--status-success)]" : "text-[var(--status-danger)]"}`}><span className="flex items-center gap-2">{message.tone === "success" ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}{message.text}</span>{message.existing && <Button size="sm" variant="outline" onClick={() => openLead(message.existing!)}>Open existing lead</Button>}</div>}
    <section className="surface-toolbar"><div className="relative w-full max-w-md"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" /><input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search by business or contact…" className="field-control pl-9" /></div></section>
    <section
      className="pipeline-board-shell min-w-0 w-full overflow-x-scroll overflow-y-hidden overscroll-x-contain rounded-[var(--radius-lg)] pb-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-400)]"
      style={{ height: "clamp(26rem, calc(100dvh - 19rem), 46rem)", scrollbarGutter: "stable both-edges" }}
      aria-label={`${segmentTab} pipeline board. Scroll horizontally to reach all ${stagesForSegment(segmentTab).length} stages.`}
      tabIndex={0}
    ><div className="pipeline-board-track flex h-full min-w-max gap-3 pr-2">
      {stagesForSegment(segmentTab).map((stage) => { const stageLeads = visibleLeads.filter((lead) => lead.status === stage); return <article key={stage} className="pipeline-stage-column flex h-full min-h-0 w-[292px] flex-none flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--surface-secondary)]">
        <header className="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-3.5 py-3"><div><p className="text-[12px] font-semibold">{stage}</p><p className="text-[10px] text-[var(--text-muted)]">{stageLeads.length} in this stage</p></div><Chip variant={STAGE_VARIANTS[stage]} size="sm">{stageLeads.length}</Chip></header>
        <div className="pipeline-stage-leads min-h-0 flex-1 space-y-2 overflow-x-hidden overflow-y-auto p-2.5">{stageLeads.map((lead) => { const state = pending.get(lead.lead_id); const actions = getEmployeeTransitionActions(lead.status, lead.segment_type); const isOwner = lead.assigned_to === currentUser?.user_id; return <div key={lead.lead_id} className="min-w-0 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface-primary)] p-3 shadow-[var(--shadow-raised)]">
          <button type="button" onClick={() => openLead(lead)} className="w-full text-left"><span className="block truncate text-[12px] font-semibold">{lead.business_name}</span><span className="mt-1 block truncate text-[10px] text-[var(--text-muted)]">{lead.contact_person} · {lead.phone}</span><span className="mt-2 block truncate text-[10px] text-[var(--text-muted)]">Owner: {lead.owner_name}</span></button>
          {state?.kind === "pending" && <p className="mt-2 text-[10px] font-semibold text-[var(--status-warning)]">{`Pending → ${state.target}`}</p>}
          {isOwner && actions.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{actions.map((action, index) => <Button key={action.to} size="sm" variant={index === 0 ? "primary" : "outline"} isLoading={transitioning === lead.lead_id} onClick={() => moveLead(lead, action.to)}>{`Move to ${action.to}`}</Button>)}</div>}
        </div>; })}{stageLeads.length === 0 && <EmptyState title="Stage is clear" description="No leads currently in this stage." className="min-h-[190px] border-0 bg-transparent" />}</div>
      </article>; })}
    </div></section>
    <div className="flex items-center justify-between gap-3"><p className="text-xs text-[var(--text-muted)]">Page {page} · showing {leads.length} of {total}</p><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</Button><Button size="sm" variant="outline" disabled={!hasMore} onClick={() => setPage((value) => value + 1)}>Next</Button></div></div>
    <RecordInspector record={inspectorData} onClose={() => { setSelectedLead(null); setCallLogs([]); setLeadContext(null); }} secondaryActions={selectedLead ? [{ label: "Log Call", icon: <PhoneCall size={15} />, onClick: () => { window.location.href = `/call-logs?lead_id=${encodeURIComponent(selectedLead.lead_id)}&lead_name=${encodeURIComponent(selectedLead.business_name)}`; } }, ...(selectedLead.assigned_to === currentUser?.user_id ? [{ label: "Create Task", icon: <ListPlus size={15} />, onClick: () => void createLeadTask(selectedLead) }] : [])] : []} primaryAction={selectedLead && selectedPrimary && selectedLead.assigned_to === currentUser?.user_id ? { label: `Move to ${selectedPrimary.to}`, icon: <ChevronRight size={15} />, onClick: () => moveLead(selectedLead, selectedPrimary.to) } : undefined} />
    <Modal open={showAddModal} onClose={() => setShowAddModal(false)} title="Create a new lead" description="Pipeline checks every historical stage, including Converted, before creating the lead." size="sm"><form onSubmit={createLead} className="space-y-4">
      <Input label="Business name" required value={newLead.business} onChange={(e) => setNewLead({ ...newLead, business: e.target.value })} /><Input label="Contact person" required value={newLead.contact} onChange={(e) => setNewLead({ ...newLead, contact: e.target.value })} /><Input label="Phone number" required value={newLead.phone} onChange={(e) => setNewLead({ ...newLead, phone: e.target.value })} /><Input label="Area or city" value={newLead.area} onChange={(e) => setNewLead({ ...newLead, area: e.target.value })} />
      <label className="space-y-1.5"><span className="field-label">Lead source</span><select className="field-control" value={newLead.source} onChange={(e) => setNewLead({ ...newLead, source: e.target.value })}><option>Cold Call</option><option>Referral</option><option>Website</option><option>Field Visit</option><option>Other</option></select></label>
      {newLead.source === "Other" && <Input label="Other lead source" required value={newLead.sourceOther} onChange={(e) => setNewLead({ ...newLead, sourceOther: e.target.value })} />}
      <div className="flex justify-end gap-2"><Button variant="outline" type="button" onClick={() => setShowAddModal(false)}>Cancel</Button><Button type="submit">Create lead</Button></div>
    </form></Modal>
  </div>;
}
