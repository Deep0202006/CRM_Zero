"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronRight, Layers, Plus, RefreshCw, Search } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { db, transactionalMutation, type LocalCallLog } from "@/lib/db";
import { transitionLead, retryPendingPipelineTransitions } from "@/lib/leadStageService";
import { PIPELINE_STAGES, type PipelineStage } from "@/lib/pipelineStages";
import { getEmployeeTransitionActions, type PipelineLeadView, type PipelineSegment } from "@/lib/pipeline/contract";
import { fetchPipelineSnapshot, type PipelinePendingState } from "@/lib/pipeline/repository";
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
  Registration: "pending", Installation: "success", Payment: "brand", "Renewal Due": "warning",
};

export default function OnboardingPage() {
  const { currentUser, isAdmin, hasOnboarding, hasDistOnboarding, hasRetOnboarding } = useAuth();
  const segments = useMemo<PipelineSegment[]>(() => [
    ...(hasRetOnboarding ? ["Retailer" as const] : []),
    ...(hasDistOnboarding ? ["Distributor" as const] : []),
  ], [hasDistOnboarding, hasRetOnboarding]);
  const [segmentTab, setSegmentTab] = useState<PipelineSegment>(hasRetOnboarding ? "Retailer" : "Distributor");
  const [leads, setLeads] = useState<PipelineLeadView[]>([]);
  const [pending, setPending] = useState(new Map<string, PipelinePendingState>());
  const [degraded, setDegraded] = useState(false);
  const [selectedLead, setSelectedLead] = useState<PipelineLeadView | null>(null);
  const [callLogs, setCallLogs] = useState<LocalCallLog[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [transitioning, setTransitioning] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newLead, setNewLead] = useState({ business: "", contact: "", phone: "", area: "", source: "Cold Call", sourceOther: "" });

  useEffect(() => { if (!segments.includes(segmentTab) && segments[0]) setSegmentTab(segments[0]); }, [segmentTab, segments]);

  const refresh = useCallback(async () => {
    if (!currentUser) return;
    const snapshot = await fetchPipelineSnapshot(segments, currentUser.user_id);
    setLeads(snapshot.leads); setPending(snapshot.pending); setDegraded(snapshot.degraded);
    setSelectedLead((selected) => selected ? snapshot.leads.find((lead) => lead.lead_id === selected.lead_id) ?? selected : null);
  }, [currentUser, segments]);

  useEffect(() => {
    if (currentUser && navigator.onLine) void retryPendingPipelineTransitions(currentUser.user_id).then(refresh);
    else void refresh();
    const reconcile = () => { if (currentUser) void retryPendingPipelineTransitions(currentUser.user_id).then(refresh); };
    window.addEventListener("focus", refresh); window.addEventListener("online", reconcile);
    return () => { window.removeEventListener("focus", refresh); window.removeEventListener("online", reconcile); };
  }, [currentUser, refresh]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const channel = supabase.channel("pipeline-authority-refresh").on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => { void refresh(); }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refresh]);

  const openLead = async (lead: PipelineLeadView) => {
    setSelectedLead(lead);
    const logs = await db.call_logs.where("lead_id").equals(lead.lead_id).and((log) => isAdmin || log.user_id === currentUser?.user_id).toArray();
    setCallLogs(logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp)));
  };

  const moveLead = async (lead: PipelineLeadView, target: PipelineStage) => {
    if (!currentUser || lead.assigned_to !== currentUser.user_id) return;
    setTransitioning(lead.lead_id); setMessage(null);
    try {
      const result = await transitionLead(lead.lead_id, target, lead.status, currentUser.user_id, lead.assigned_to);
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
    await transactionalMutation("leads", "INSERT", {
      lead_id: crypto.randomUUID(), business_name: newLead.business.trim(), contact_person: newLead.contact.trim(), phone: newLead.phone.trim(),
      segment_type: segmentTab, status: "New", lead_source: newLead.source === "Other" ? newLead.sourceOther.trim() || "Other" : newLead.source,
      area: newLead.area.trim() || undefined, assigned_to: currentUser.user_id, created_at: new Date().toISOString(),
    });
    setNewLead({ business: "", contact: "", phone: "", area: "", source: "Cold Call", sourceOther: "" }); setShowAddModal(false); await refresh();
  };

  const visibleLeads = leads.filter((lead) => lead.segment_type === segmentTab && `${lead.business_name} ${lead.contact_person}`.toLowerCase().includes(searchQuery.toLowerCase()));
  const inspectorData: RecordInspectorData | null = selectedLead ? {
    id: selectedLead.lead_id, title: selectedLead.business_name, subtitle: `${selectedLead.contact_person} · ${selectedLead.phone}`, type: "lead",
    status: selectedLead.status, statusVariant: STAGE_VARIANTS[selectedLead.status], phone: selectedLead.phone, address: selectedLead.area ?? undefined,
    owner: selectedLead.owner_name, createdAt: selectedLead.created_at, details: { Segment: selectedLead.segment_type, Source: selectedLead.lead_source || "N/A", Call_Logs_Count: callLogs.length },
  } : null;
  const selectedPrimary = selectedLead ? getEmployeeTransitionActions(selectedLead.status)[0] : undefined;

  if (!hasOnboarding) return <div className="app-page"><section className="access-state"><AlertCircle size={22} /><div><h1 className="section-title">Onboarding access is restricted</h1><p className="mt-2 text-[13px] text-[var(--text-muted)]">Ask an administrator to update your role.</p></div></section></div>;

  return <div className="app-page relative">
    <PageHeader eyebrow="Sales onboarding" icon={<Layers size={16} />} title="Lead conversion pipeline" description="Server-confirmed leads with simple, assigned-owner stage actions."
      actions={<><div className="segmented-control">{segments.map((segment) => <button key={segment} type="button" aria-pressed={segmentTab === segment} onClick={() => setSegmentTab(segment)}>{segment}s</button>)}</div><Button onClick={() => setShowAddModal(true)} icon={<Plus size={15} />}>New lead</Button></>}
      meta={<><Chip variant="brand" size="sm" dot>{visibleLeads.length} visible leads</Chip><Chip variant="neutral" size="sm">8 stages</Chip></>} />
    {degraded && <div role="status" className="flex items-center justify-between rounded-[var(--radius-md)] border border-[var(--status-warning)]/30 bg-[var(--status-warning-soft)] p-3 text-[12px]"><span>Offline or server history unavailable. Showing durable local Pipeline state.</span><Button size="sm" variant="outline" onClick={refresh} icon={<RefreshCw size={13} />}>Retry</Button></div>}
    {message && <div className={`flex items-center gap-2 rounded-[var(--radius-md)] border p-3 text-[12px] ${message.tone === "success" ? "text-[var(--status-success)]" : "text-[var(--status-danger)]"}`}>{message.tone === "success" ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}{message.text}</div>}
    <section className="surface-toolbar"><div className="relative w-full max-w-md"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" /><input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search by business or contact…" className="field-control pl-9" /></div></section>
    <section
      className="pipeline-board-shell min-w-0 w-full overflow-x-scroll overflow-y-hidden overscroll-x-contain rounded-[var(--radius-lg)] pb-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-400)]"
      style={{ height: "clamp(26rem, calc(100dvh - 19rem), 46rem)", scrollbarGutter: "stable both-edges" }}
      aria-label={`${segmentTab} pipeline board. Scroll horizontally to reach all eight stages.`}
      tabIndex={0}
    ><div className="pipeline-board-track flex h-full min-w-max gap-3 pr-2">
      {PIPELINE_STAGES.map((stage) => { const stageLeads = visibleLeads.filter((lead) => lead.status === stage); return <article key={stage} className="pipeline-stage-column flex h-full min-h-0 w-[292px] flex-none flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--surface-secondary)]">
        <header className="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-3.5 py-3"><div><p className="text-[12px] font-semibold">{stage}</p><p className="text-[10px] text-[var(--text-muted)]">{stageLeads.length} in this stage</p></div><Chip variant={STAGE_VARIANTS[stage]} size="sm">{stageLeads.length}</Chip></header>
        <div className="pipeline-stage-leads min-h-0 flex-1 space-y-2 overflow-x-hidden overflow-y-auto p-2.5">{stageLeads.map((lead) => { const state = pending.get(lead.lead_id); const actions = getEmployeeTransitionActions(lead.status); const isOwner = lead.assigned_to === currentUser?.user_id; return <div key={lead.lead_id} className="min-w-0 overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface-primary)] p-3 shadow-[var(--shadow-raised)]">
          <button type="button" onClick={() => openLead(lead)} className="w-full text-left"><span className="block truncate text-[12px] font-semibold">{lead.business_name}</span><span className="mt-1 block truncate text-[10px] text-[var(--text-muted)]">{lead.contact_person} · {lead.phone}</span><span className="mt-2 block truncate text-[10px] text-[var(--text-muted)]">Owner: {lead.owner_name}</span></button>
          {state && <p className={`mt-2 text-[10px] font-semibold ${state.kind === "pending" ? "text-[var(--status-warning)]" : "text-[var(--status-danger)]"}`}>{state.kind === "pending" ? `Pending → ${state.target}` : state.kind === "conflict" ? `Needs review · attempted ${state.target}` : `Legacy move to ${state.target} needs reconciliation`}</p>}
          {isOwner && actions.length > 0 && <div className="mt-3 flex flex-wrap gap-1.5">{actions.map((action, index) => <Button key={action.to} size="sm" variant={index === 0 ? "primary" : "outline"} isLoading={transitioning === lead.lead_id} onClick={() => moveLead(lead, action.to)}>{`Move to ${action.to}`}</Button>)}</div>}
        </div>; })}{stageLeads.length === 0 && <EmptyState title="Stage is clear" description="No leads currently in this stage." className="min-h-[190px] border-0 bg-transparent" />}</div>
      </article>; })}
    </div></section>
    <RecordInspector record={inspectorData} onClose={() => { setSelectedLead(null); setCallLogs([]); }} primaryAction={selectedLead && selectedPrimary && selectedLead.assigned_to === currentUser?.user_id ? { label: `Move to ${selectedPrimary.to}`, icon: <ChevronRight size={15} />, onClick: () => moveLead(selectedLead, selectedPrimary.to) } : undefined} />
    <Modal open={showAddModal} onClose={() => setShowAddModal(false)} title="Create a new lead" description="The new lead stays visible locally until server confirmation." size="sm"><form onSubmit={createLead} className="space-y-4">
      <Input label="Business name" required value={newLead.business} onChange={(e) => setNewLead({ ...newLead, business: e.target.value })} /><Input label="Contact person" required value={newLead.contact} onChange={(e) => setNewLead({ ...newLead, contact: e.target.value })} /><Input label="Phone number" required value={newLead.phone} onChange={(e) => setNewLead({ ...newLead, phone: e.target.value })} /><Input label="Area or city" value={newLead.area} onChange={(e) => setNewLead({ ...newLead, area: e.target.value })} />
      <label className="space-y-1.5"><span className="field-label">Lead source</span><select className="field-control" value={newLead.source} onChange={(e) => setNewLead({ ...newLead, source: e.target.value })}><option>Cold Call</option><option>Referral</option><option>Website</option><option>Field Visit</option><option>Other</option></select></label>
      {newLead.source === "Other" && <Input label="Other lead source" required value={newLead.sourceOther} onChange={(e) => setNewLead({ ...newLead, sourceOther: e.target.value })} />}
      <div className="flex justify-end gap-2"><Button variant="outline" type="button" onClick={() => setShowAddModal(false)}>Cancel</Button><Button type="submit">Create lead</Button></div>
    </form></Modal>
  </div>;
}
