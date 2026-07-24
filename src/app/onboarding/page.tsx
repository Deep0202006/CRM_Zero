"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { db, transactionalMutation, LocalLead, LocalCallLog } from "@/lib/db";
import { validateLeadStatusTransition, LeadStatus } from "@/lib/validation";
import { PipelineStage, getNextPipelineStage } from "@/lib/pipelineStages";
import { transitionLead } from "@/lib/leadStageService";
import {
  Plus,
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Layers,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Chip } from "@/components/ui/Chip";
import { RecordInspector, RecordInspectorData } from "@/components/RecordInspector";
import { PageHeader } from "@/components/ui/PageHeader";
import { Modal } from "@/components/ui/Modal";
import { EmptyState } from "@/components/ui/EmptyState";

type GateKey = `${LeadStatus}→${LeadStatus}`;

interface GateConfig {
  label: string;
  placeholder: string;
  required: boolean;
}

const STAGE_GATES: Partial<Record<GateKey, GateConfig>> = {
  "New→Contacted": { label: "Call outcome", placeholder: "What happened on the call? (e.g. Spoke for 5 mins)", required: true },
  "Contacted→Interested": { label: "Interest reason", placeholder: "What made the client interested?", required: true },
  "Interested→Registration": { label: "Agreement confirmation", placeholder: "How did they confirm registration?", required: true },
  "Registration→Installation": { label: "Installation Plan", placeholder: "Installation expectations and dates", required: true },
  "Installation→Payment": { label: "Payment confirmation", placeholder: "Confirm payment received. Ref no.", required: true },
  "New→Not Interested": { label: "Reason for rejection", placeholder: "Why is the client not interested?", required: true },
  "Contacted→Not Interested": { label: "Reason for rejection", placeholder: "Why is the client not interested?", required: true },
  "Interested→Not Interested": { label: "Reason for rejection", placeholder: "Why did they change their mind?", required: true },
};

const STAGE_META: { display: string; code: LeadStatus; variant: "neutral" | "info" | "warning" | "danger" | "pending" | "success" | "brand" }[] = [
  { display: "New", code: "New", variant: "neutral" },
  { display: "Contacted", code: "Contacted", variant: "info" },
  { display: "Interested", code: "Interested", variant: "warning" },
  { display: "Not Interested", code: "Not Interested", variant: "danger" },
  { display: "Registration", code: "Registration", variant: "pending" },
  { display: "Installation", code: "Installation", variant: "success" },
  { display: "Payment", code: "Payment", variant: "brand" },
];

const DISTRIBUTOR_STAGES = STAGE_META.filter((s) => s.code !== "Not Interested");
const RETAILER_STAGES = STAGE_META.filter((s) => ["New", "Contacted", "Interested", "Registration"].includes(s.code));

export default function OnboardingPage() {
  const { currentUser, isAdmin, hasOnboarding, hasDistOnboarding, hasRetOnboarding } = useAuth();

  const [leads, setLeads] = useState<LocalLead[]>([]);
  const [segmentTab, setSegmentTab] = useState<"Distributor" | "Retailer">("Retailer");
  const [selectedLead, setSelectedLead] = useState<LocalLead | null>(null);
  const [callLogs, setCallLogs] = useState<LocalCallLog[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  const [showAddModal, setShowAddModal] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [gateModal, setGateModal] = useState<{
    lead: LocalLead;
    targetStatus: LeadStatus;
    config: GateConfig;
  } | null>(null);
  const [gateNote, setGateNote] = useState("");
  const [gateLoading, setGateLoading] = useState(false);

  const [newBusinessName, setNewBusinessName] = useState("");
  const [newContactPerson, setNewContactPerson] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newSegmentType, setNewSegmentType] = useState<"Distributor" | "Retailer">("Retailer");
  const [newLeadSource, setNewLeadSource] = useState("Cold Call");
  const [newLeadSourceOther, setNewLeadSourceOther] = useState("");
  const [newArea, setNewArea] = useState("");

  const canViewDistributors = hasDistOnboarding;
  const canViewRetailers = hasRetOnboarding;

  useEffect(() => {
    if (!canViewRetailers && canViewDistributors) setSegmentTab("Distributor");
  }, [canViewRetailers, canViewDistributors]);

  const loadLeads = useCallback(async () => {
    try {
      setLeads(await db.leads.toArray());
    } catch (err) {
      console.error("Failed to load leads", err);
    }
  }, []);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  const handleOpenLead = async (lead: LocalLead) => {
    setSelectedLead(lead);
    setErrorMsg(null);
    setSuccessMsg(null);
    const logs = await db.call_logs.where("lead_id").equals(lead.lead_id).toArray();
    setCallLogs(logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
  };

  const handleCloseLead = () => {
    setSelectedLead(null);
    setCallLogs([]);
  };

  const handleRequestTransition = (lead: LocalLead, targetStatus: LeadStatus) => {
    if (!lead || !targetStatus) return;
    if (lead.status === targetStatus) return;
    if (!validateLeadStatusTransition(lead.status, targetStatus)) {
      setErrorMsg(`Transition from "${lead.status}" → "${targetStatus}" is not permitted.`);
      return;
    }
    setErrorMsg(null);
    executeTransition(lead, targetStatus, null);
  };

  const executeTransition = async (lead: LocalLead, targetStatus: LeadStatus, note: string | null) => {
    if (!lead || !targetStatus) return;
    setGateLoading(true);
    try {
      const now = new Date().toISOString();

      if (note && note.trim()) {
        const gateKey = `${lead.status}→${targetStatus}` as GateKey;
        const gateLabel = STAGE_GATES[gateKey]?.label || "Stage note";
        const logEntry: LocalCallLog = {
          log_id: crypto.randomUUID(),
          user_id: currentUser?.user_id || null,
          lead_id: lead.lead_id,
          timestamp: now,
          outcome: `[${gateLabel}] → ${targetStatus}`,
          notes: note.trim(),
          next_followup_date: null,
        };
        await transactionalMutation("call_logs", "INSERT", logEntry);
      }

      const updateData: { status: string; onboarded_at?: string } = { status: targetStatus };
      if (targetStatus === "Installation") updateData.onboarded_at = now;

      // First run the transition service which handles atomicity and concurrency
      await transitionLead(lead.lead_id, targetStatus as PipelineStage, lead.status as PipelineStage);
      
      // If there are additional fields to update (like onboarded_at), queue them
      if (targetStatus === "Installation") {
        await transactionalMutation("leads", "UPDATE", { lead_id: lead.lead_id, onboarded_at: now });
      }

      await loadLeads();
      if (selectedLead?.lead_id === lead.lead_id) {
        setSelectedLead({ ...lead, status: targetStatus });
        const logs = await db.call_logs.where("lead_id").equals(lead.lead_id).toArray();
        setCallLogs(logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
      }
      setSuccessMsg(`Lead moved to "${targetStatus}".`);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err) {
      setErrorMsg("Failed to update lead status.");
    } finally {
      setGateLoading(false);
      setGateModal(null);
      setGateNote("");
    }
  };

  const handleGateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!gateModal) return;
    if (gateModal.config.required && !gateNote.trim()) {
      setErrorMsg("This field is required to proceed.");
      return;
    }
    setErrorMsg(null);
    executeTransition(gateModal.lead, gateModal.targetStatus, gateNote);
  };

  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!newBusinessName.trim() || !newContactPerson.trim() || !newPhone.trim()) {
      setErrorMsg("Fill in all fields.");
      return;
    }
    try {
      const lead: LocalLead = {
        lead_id: crypto.randomUUID(),
        business_name: newBusinessName.trim(),
        contact_person: newContactPerson.trim(),
        phone: newPhone.trim(),
        segment_type: newSegmentType,
        status: "New",
        lead_source: newLeadSource === "Other" ? newLeadSourceOther.trim() || "Other" : newLeadSource,
        area: newArea.trim() || undefined,
        assigned_to: currentUser?.user_id || "unassigned",
        created_at: new Date().toISOString(),
      };
      await transactionalMutation("leads", "INSERT", lead);
      setNewBusinessName("");
      setNewContactPerson("");
      setNewPhone("");
      setNewArea("");
      setNewLeadSource("Cold Call");
      setNewLeadSourceOther("");
      setShowAddModal(false);
      await loadLeads();
      setSuccessMsg("Lead created.");
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err) {
      setErrorMsg("Failed to create lead.");
    }
  };

  const visibleLeads = leads.filter(
    (l) =>
      l.segment_type === segmentTab &&
      (l.business_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        l.contact_person.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const activeStages = segmentTab === "Retailer" ? RETAILER_STAGES : DISTRIBUTOR_STAGES;

  if (!hasOnboarding) {
    return (
      <div className="app-page">
        <section className="access-state" role="status" aria-labelledby="onboarding-access-title">
          <span className="access-state__icon" aria-hidden="true"><AlertCircle size={22} /></span>
          <div>
            <p className="section-kicker">Permission required</p>
            <h1 id="onboarding-access-title" className="section-title mt-1">Onboarding access is restricted</h1>
            <p className="mt-2 max-w-md text-[13px] leading-6 text-[var(--text-muted)]">
              Your account does not currently include the Onboarding capability. Ask an administrator to update your role.
            </p>
          </div>
        </section>
      </div>
    );
  }

  const inspectorData: RecordInspectorData | null = selectedLead
    ? {
        id: selectedLead.lead_id,
        title: selectedLead.business_name,
        subtitle: `${selectedLead.contact_person} (@${selectedLead.assigned_to}) - ${selectedLead.phone}`,
        type: "lead",
        status: selectedLead.status,
        statusVariant: STAGE_META.find((s) => s.code === selectedLead.status)?.variant || "neutral",
        phone: selectedLead.phone,
        address: selectedLead.area,
        owner: selectedLead.assigned_to ?? undefined,
        createdAt: selectedLead.created_at,
        details: {
          Segment: selectedLead.segment_type,
          Source: selectedLead.lead_source || "N/A",
          Call_Logs_Count: callLogs.length,
        },
      }
    : null;

  return (
    <div className="app-page relative">
      <PageHeader
        eyebrow="Sales onboarding"
        icon={<Layers size={16} />}
        title="Lead conversion pipeline"
        description="A stage-gated workspace for moving retailer and distributor prospects from first contact to successful onboarding."
        actions={
          <>
            <div className="segmented-control" aria-label="Lead segment">
              {canViewRetailers && (
                <button type="button" aria-pressed={segmentTab === "Retailer"} onClick={() => setSegmentTab("Retailer")}>Retailers</button>
              )}
              {canViewDistributors && (
                <button type="button" aria-pressed={segmentTab === "Distributor"} onClick={() => setSegmentTab("Distributor")}>Distributors</button>
              )}
            </div>
            <Button
              onClick={() => {
                setNewSegmentType(segmentTab);
                setShowAddModal(true);
              }}
              icon={<Plus size={15} />}
            >
              New lead
            </Button>
          </>
        }
        meta={
          <>
            <Chip variant="brand" size="sm" dot>{visibleLeads.length} visible leads</Chip>
            <Chip variant="neutral" size="sm">{activeStages.length} active stages</Chip>
          </>
        }
      />

      {successMsg && (
        <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--status-success)]/20 bg-[var(--status-success-soft)] p-3.5 text-[12px] font-medium text-[var(--status-success)]">
          <CheckCircle2 size={16} className="shrink-0" /> {successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--status-danger)]/20 bg-[var(--status-danger-soft)] p-3.5 text-[12px] font-medium text-[var(--status-danger)]">
          <AlertCircle size={16} className="shrink-0" /> {errorMsg}
        </div>
      )}

      <section className="surface-toolbar flex-col sm:flex-row" aria-label="Pipeline controls">
        <div className="relative w-full flex-1 sm:max-w-md">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="search"
            placeholder="Search by business or contact…"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="h-10 w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-secondary)] pl-9 pr-3 text-[13px] font-medium text-[var(--text-primary)] outline-none transition focus:border-[var(--brand-500)] focus:ring-4 focus:ring-[var(--brand-glow)]"
          />
        </div>
        <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:justify-end">
          <span className="text-[11px] font-medium text-[var(--text-muted)]">Drag-free, validated stage movement</span>
          <Chip variant="brand" size="sm">{visibleLeads.length} leads</Chip>
        </div>
      </section>

      <section className="-mx-4 overflow-x-auto px-4 pb-3 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8" aria-label={`${segmentTab} pipeline board`}>
        <div className="flex min-w-max gap-3 xl:min-w-0">
          {activeStages.map((stage) => {
            const stageLeads = visibleLeads.filter((lead) => lead.status === stage.code);
            return (
              <article key={stage.code} className="flex w-[292px] shrink-0 flex-col rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--surface-secondary)] xl:min-w-[240px] xl:flex-1">
                <header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-3.5 py-3">
                  <div>
                    <p className="text-[12px] font-semibold text-[var(--text-primary)]">{stage.display}</p>
                    <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">{stageLeads.length ? `${stageLeads.length} in this stage` : "No active leads"}</p>
                  </div>
                  <Chip variant={stage.variant} size="sm">{stageLeads.length}</Chip>
                </header>

                <div className="min-h-[220px] space-y-2 p-2.5">
                  {stageLeads.map((lead) => {
                    const initials = lead.business_name.trim().slice(0, 2).toUpperCase();
                    return (
                      <button
                        key={lead.lead_id}
                        type="button"
                        onClick={() => handleOpenLead(lead)}
                        className={`group w-full rounded-[var(--radius-md)] border bg-[var(--surface-primary)] p-3 text-left shadow-[var(--shadow-raised)] transition hover:-translate-y-px hover:border-[var(--brand-300)] hover:shadow-[var(--shadow-card-hover)] ${
                          selectedLead?.lead_id === lead.lead_id ? "border-[var(--brand-400)] ring-2 ring-[var(--brand-100)]" : "border-[var(--border-subtle)]"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[var(--brand-50)] text-[11px] font-bold text-[var(--brand-800)]">{initials}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[12px] font-semibold text-[var(--text-primary)]">{lead.business_name}</span>
                            <span className="mt-0.5 block truncate text-[10px] text-[var(--text-muted)]">{lead.contact_person} · {lead.phone}</span>
                          </span>
                        </div>
                        <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-2.5">
                          <span className="truncate text-[10px] font-medium text-[var(--text-muted)]">{lead.area || "Area not set"}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-semibold text-[var(--text-muted)] group-hover:text-[var(--brand-600)]">Inspect</span>
                            {getNextPipelineStage(lead.status as PipelineStage) && (
                              <button 
                                type="button" 
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRequestTransition(lead, getNextPipelineStage(lead.status as PipelineStage)!);
                                }}
                                className="rounded-[var(--radius-sm)] bg-[var(--brand-50)] px-2 py-1 text-[10px] font-bold text-[var(--brand-700)] transition hover:bg-[var(--brand-100)]"
                              >
                                Move forward
                              </button>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}

                  {stageLeads.length === 0 && (
                    <EmptyState title="Stage is clear" description="Leads will appear here after a valid transition." className="min-h-[190px] border-0 bg-transparent px-3 py-6" />
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <RecordInspector
        record={inspectorData}
        onClose={handleCloseLead}
        primaryAction={
          selectedLead && getNextPipelineStage(selectedLead.status as PipelineStage)
            ? {
                label: `Move to ${getNextPipelineStage(selectedLead.status as PipelineStage)}`,
                icon: <ChevronRight size={15} />,
                onClick: () => handleRequestTransition(selectedLead, getNextPipelineStage(selectedLead.status as PipelineStage)!),
              }
            : undefined
        }
      />

      <Modal
        open={Boolean(gateModal)}
        onClose={() => setGateModal(null)}
        title={gateModal ? `Move lead to ${gateModal.targetStatus}` : "Stage transition"}
        description={gateModal?.config.placeholder}
        size="sm"
      >
        {gateModal && (
          <form onSubmit={handleGateSubmit} className="space-y-4">
            <div>
              <label htmlFor="gate-note" className="mb-1.5 block text-[12px] font-semibold text-[var(--text-secondary)]">{gateModal.config.label}</label>
              <textarea
                id="gate-note"
                rows={4}
                required={gateModal.config.required}
                value={gateNote}
                onChange={(event) => setGateNote(event.target.value)}
                placeholder="Add the evidence or context required for this stage change…"
                className="w-full resize-y rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-3 text-[13px] text-[var(--text-primary)] outline-none transition focus:border-[var(--brand-500)] focus:ring-4 focus:ring-[var(--brand-glow)]"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" type="button" onClick={() => setGateModal(null)}>Cancel</Button>
              <Button type="submit" isLoading={gateLoading}>Confirm transition</Button>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        title="Create a new lead"
        description="Add the minimum verified details. Ownership and lifecycle rules remain unchanged."
        size="sm"
      >
        <form onSubmit={handleCreateLead} className="space-y-4">
          <Input label="Business name" required value={newBusinessName} onChange={(event) => setNewBusinessName(event.target.value)} />
          <Input label="Contact person" required value={newContactPerson} onChange={(event) => setNewContactPerson(event.target.value)} />
          <Input label="Phone number" required value={newPhone} onChange={(event) => setNewPhone(event.target.value)} />
          <Input label="Area or city" value={newArea} onChange={(event) => setNewArea(event.target.value)} />
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="field-label">Segment</span>
              <select
                className="field-control"
                value={newSegmentType}
                onChange={(event) => setNewSegmentType(event.target.value as "Distributor" | "Retailer")}
              >
                {canViewRetailers && <option value="Retailer">Retailer</option>}
                {canViewDistributors && <option value="Distributor">Distributor</option>}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="field-label">Lead source</span>
              <select className="field-control" value={newLeadSource} onChange={(event) => setNewLeadSource(event.target.value)}>
                <option value="Cold Call">Cold call</option>
                <option value="Referral">Referral</option>
                <option value="Website">Website</option>
                <option value="Field Visit">Field visit</option>
                <option value="Other">Other</option>
              </select>
            </label>
          </div>
          {newLeadSource === "Other" && (
            <Input
              label="Other lead source"
              required
              value={newLeadSourceOther}
              onChange={(event) => setNewLeadSourceOther(event.target.value)}
              placeholder="Enter the source"
            />
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" type="button" onClick={() => setShowAddModal(false)}>Cancel</Button>
            <Button type="submit">Create lead</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
