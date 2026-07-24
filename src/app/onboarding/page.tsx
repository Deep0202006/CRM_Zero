"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { db, transactionalMutation, LocalLead, LocalCallLog } from "@/lib/db";
import { type LocalTask } from "@/lib/taskEngine";
import { validateLeadStatusTransition, LeadStatus } from "@/lib/validation";
import { isMobileDevice } from "@/lib/deviceUtils";
import {
  Plus,
  X,
  Phone,
  FolderOpen,
  AlertCircle,
  CheckCircle2,
  Clock,
  FileText,
  ArrowRight,
  Lock,
  Layers,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Chip } from "@/components/ui/Chip";
import { RecordInspector, RecordInspectorData } from "@/components/RecordInspector";

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
    const gateKey = `${lead.status}→${targetStatus}` as GateKey;
    const config = STAGE_GATES[gateKey];
    if (config) {
      setGateNote("");
      setGateModal({ lead, targetStatus, config });
    } else {
      executeTransition(lead, targetStatus, null);
    }
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

      const updateData: any = { status: targetStatus };
      if (targetStatus === "Installation") updateData.onboarded_at = now;

      await transactionalMutation("leads", "UPDATE", { lead_id: lead.lead_id, ...updateData });

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
        lead_source: newLeadSource,
        area: newArea.trim() || undefined,
        assigned_to: currentUser?.user_id || "unassigned",
        created_at: new Date().toISOString(),
      };
      await transactionalMutation("leads", "INSERT", lead);
      setNewBusinessName("");
      setNewContactPerson("");
      setNewPhone("");
      setNewArea("");
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
      <Card className="max-w-md mx-auto mt-16 text-center space-y-4 p-8">
        <AlertCircle size={40} className="mx-auto text-[var(--status-danger)]" />
        <h3 className="text-base font-black text-[var(--text-primary)]">Access Restricted</h3>
        <p className="text-xs text-[var(--text-muted)] font-semibold">You don't have Onboarding capability assigned.</p>
      </Card>
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
    <div className="space-y-6 w-full max-w-7xl mx-auto relative">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-[var(--text-primary)]">Lead Onboarding Pipeline</h1>
          <p className="text-xs text-[var(--text-muted)] font-bold uppercase tracking-wider">
            Stage-gated conversion workspace
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex p-1 bg-[var(--surface-secondary)] rounded-[var(--radius-md)] gap-1">
            {canViewRetailers && (
              <button
                onClick={() => setSegmentTab("Retailer")}
                className={`px-3 py-1.5 rounded-[var(--radius-sm)] text-xs font-bold transition-all cursor-pointer ${
                  segmentTab === "Retailer"
                    ? "bg-[var(--surface-primary)] text-[var(--brand-500)] shadow-xs"
                    : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                Retailers
              </button>
            )}
            {canViewDistributors && (
              <button
                onClick={() => setSegmentTab("Distributor")}
                className={`px-3 py-1.5 rounded-[var(--radius-sm)] text-xs font-bold transition-all cursor-pointer ${
                  segmentTab === "Distributor"
                    ? "bg-[var(--surface-primary)] text-[var(--brand-500)] shadow-xs"
                    : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                Distributors
              </button>
            )}
          </div>

          <Button size="sm" onClick={() => setShowAddModal(true)} icon={<Plus size={14} />}>
            New Lead
          </Button>
        </div>
      </div>

      {successMsg && (
        <div className="p-3 bg-[var(--status-success-soft)] border border-[var(--status-success)]/20 text-[var(--status-success)] rounded-[var(--radius-md)] text-xs font-bold">
          ✓ {successMsg}
        </div>
      )}
      {errorMsg && (
        <div className="p-3 bg-[var(--status-danger-soft)] border border-[var(--status-danger)]/20 text-[var(--status-danger)] rounded-[var(--radius-md)] text-xs font-bold flex items-center gap-2">
          <AlertCircle size={14} /> {errorMsg}
        </div>
      )}

      {/* Toolbar & Search */}
      <Card className="p-3 flex items-center justify-between gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder="Search leads by business or contact..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 bg-[var(--surface-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] text-xs font-semibold text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand-500)]"
          />
        </div>
        <Chip variant="brand" size="sm">
          {visibleLeads.length} Leads
        </Chip>
      </Card>

      {/* Kanban Board Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 lg:grid-cols-5 gap-4 overflow-x-auto pb-4">
        {activeStages.map((stage) => {
          const stageLeads = visibleLeads.filter((l) => l.status === stage.code);
          return (
            <div key={stage.code} className="space-y-3 min-w-[220px]">
              <div className="flex items-center justify-between p-2 bg-[var(--surface-secondary)] rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
                <span className="text-xs font-black text-[var(--text-primary)]">{stage.display}</span>
                <Chip variant={stage.variant} size="sm">
                  {stageLeads.length}
                </Chip>
              </div>

              <div className="space-y-2">
                {stageLeads.map((lead) => (
                  <Card
                    key={lead.lead_id}
                    className={`p-3 space-y-2 cursor-pointer transition-all hover:border-[var(--brand-500)] ${
                      selectedLead?.lead_id === lead.lead_id ? "border-[var(--brand-500)] ring-2 ring-[var(--brand-100)]" : ""
                    }`}
                    onClick={() => handleOpenLead(lead)}
                  >
                    <div className="flex justify-between items-start">
                      <h3 className="text-xs font-black text-[var(--text-primary)] truncate">{lead.business_name}</h3>
                    </div>

                    <p className="text-[11px] text-[var(--text-muted)] font-semibold truncate">
                      {lead.contact_person} (@{lead.assigned_to}) - {lead.phone}
                    </p>

                    <div className="flex justify-between items-center pt-2 border-t border-[var(--border-subtle)] text-[10px]">
                      <span className="font-mono text-[var(--text-muted)]">{lead.area || "No Area"}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-[10px]"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenLead(lead);
                        }}
                      >
                        Inspect →
                      </Button>
                    </div>
                  </Card>
                ))}

                {stageLeads.length === 0 && (
                  <div className="p-4 text-center border border-dashed border-[var(--border-subtle)] rounded-[var(--radius-md)] text-[11px] text-[var(--text-muted)] font-semibold">
                    Empty Stage
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Persistent Record Inspector Drawer */}
      <RecordInspector
        record={inspectorData}
        onClose={handleCloseLead}
        onAction={(action, rec) => {
          if (selectedLead && selectedLead.status === "New") {
            handleRequestTransition(selectedLead, "Contacted");
          }
        }}
      />

      {/* Stage Gate Modal */}
      {gateModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-[var(--z-modal)] flex items-center justify-center p-4">
          <Card className="w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-black text-[var(--text-primary)]">
              Stage Transition Gate: {gateModal.targetStatus}
            </h3>
            <p className="text-xs text-[var(--text-muted)] font-semibold">{gateModal.config.placeholder}</p>
            <form onSubmit={handleGateSubmit} className="space-y-3">
              <textarea
                rows={3}
                required={gateModal.config.required}
                value={gateNote}
                onChange={(e) => setGateNote(e.target.value)}
                placeholder="Enter mandatory transition notes..."
                className="w-full p-3 bg-[var(--surface-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] text-xs font-semibold text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand-500)]"
              />
              <div className="flex gap-2">
                <Button variant="secondary" className="flex-1" type="button" onClick={() => setGateModal(null)}>
                  Cancel
                </Button>
                <Button type="submit" isLoading={gateLoading} className="flex-1">
                  Confirm Transition
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* New Lead Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs z-[var(--z-modal)] flex items-center justify-center p-4">
          <Card className="w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-black text-[var(--text-primary)]">Create New Lead</h3>
            <form onSubmit={handleCreateLead} className="space-y-3">
              <Input
                label="Business Name"
                required
                value={newBusinessName}
                onChange={(e) => setNewBusinessName(e.target.value)}
              />
              <Input
                label="Contact Person"
                required
                value={newContactPerson}
                onChange={(e) => setNewContactPerson(e.target.value)}
              />
              <Input
                label="Phone Number"
                required
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
              />
              <Input
                label="Area / City"
                value={newArea}
                onChange={(e) => setNewArea(e.target.value)}
              />
              <div className="flex gap-2 pt-2">
                <Button variant="secondary" className="flex-1" type="button" onClick={() => setShowAddModal(false)}>
                  Cancel
                </Button>
                <Button type="submit" className="flex-1">
                  Create Lead
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
