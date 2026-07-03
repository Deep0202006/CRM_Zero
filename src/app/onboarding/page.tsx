"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { db, LocalLead, LocalCallLog } from "@/lib/db";
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
} from "lucide-react";

// ─── Stage gate configuration ────────────────────────────────────────────────
type GateKey = `${LeadStatus}→${LeadStatus}`;

interface GateConfig {
  label: string;
  placeholder: string;
  required: boolean;
}

const STAGE_GATES: Partial<Record<GateKey, GateConfig>> = {
  "New→Contacted":           { label: "Call outcome",          placeholder: "What happened on the call? (e.g. Left voicemail, spoke for 5 mins)", required: true },
  "Contacted→Interested":    { label: "Interest reason",       placeholder: "What made the client interested? (e.g. Liked the pricing, asked for demo)", required: true },
  "Interested→Registration": { label: "Agreement confirmation", placeholder: "How did they confirm they want to register? (e.g. Said yes over phone, WhatsApp message)", required: true },
  "Registration→Installation": { label: "Installation Plan", placeholder: "Installation expectations and dates", required: true },
  "Installation→Payment":      { label: "Payment confirmation", placeholder: "Confirm payment received. Reference no. if available", required: true },
  "New→Not Interested":      { label: "Reason for rejection",  placeholder: "Why is the client not interested?", required: true },
  "Contacted→Not Interested":{ label: "Reason for rejection",  placeholder: "Why is the client not interested?", required: true },
  "Interested→Not Interested":{ label: "Reason for rejection", placeholder: "Why did they change their mind?", required: true },
};

// ─── Stage display config ────────────────────────────────────────────────────
const STAGE_META: { display: string; code: LeadStatus; color: string; dot: string }[] = [
  { display: "New",            code: "New",           color: "bg-slate-100 border-slate-200",    dot: "bg-slate-400"   },
  { display: "Contacted",      code: "Contacted",     color: "bg-blue-50 border-blue-100",       dot: "bg-blue-500"    },
  { display: "Interested",     code: "Interested",    color: "bg-amber-50 border-amber-100",     dot: "bg-amber-500"   },
  { display: "Not Interested", code: "Not Interested",color: "bg-rose-50 border-rose-100",       dot: "bg-rose-400"    },
  { display: "Registration",   code: "Registration",  color: "bg-violet-50 border-violet-100",   dot: "bg-violet-500"  },
  { display: "Installation",   code: "Installation",  color: "bg-emerald-50 border-emerald-100", dot: "bg-emerald-500" },
  { display: "Payment",        code: "Payment",       color: "bg-orange-50 border-orange-100",   dot: "bg-orange-500"  },
];

// Active stages shown in kanban (Not Interested is a terminal state shown separately)
const KANBAN_STAGES = STAGE_META.filter(s => s.code !== "Not Interested");

export default function OnboardingPage() {
  const { currentUser, capabilities, isAdmin, hasOnboarding, hasDistOnboarding, hasRetOnboarding } = useAuth();

  const [leads, setLeads] = useState<LocalLead[]>([]);
  const [segmentTab, setSegmentTab] = useState<"Distributor" | "Retailer">("Retailer");
  const [selectedLead, setSelectedLead] = useState<LocalLead | null>(null);
  const [callLogs, setCallLogs] = useState<LocalCallLog[]>([]);

  const [showAddModal, setShowAddModal] = useState(false);
  const [errorMsg, setErrorMsg]   = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // ── Stage Gate Modal state ───────────────────────────────────────────────
  const [gateModal, setGateModal] = useState<{
    lead: LocalLead;
    targetStatus: LeadStatus;
    config: GateConfig;
  } | null>(null);
  const [gateNote, setGateNote] = useState("");
  const [gateLoading, setGateLoading] = useState(false);

  // ── New Lead Form state ──────────────────────────────────────────────────
  const [newBusinessName,   setNewBusinessName]   = useState("");
  const [newContactPerson,  setNewContactPerson]  = useState("");
  const [newPhone,          setNewPhone]          = useState("");
  const [newSegmentType,    setNewSegmentType]    = useState<"Distributor" | "Retailer">("Retailer");
  const [newLeadSource,     setNewLeadSource]     = useState("Cold Call");
  const [newLeadSourceOther,setNewLeadSourceOther]= useState("");
  const [newArea,           setNewArea]           = useState("");

  // ── Progressive Disclosure State ──────────────────────────────────────────
  const [showCallOutcome, setShowCallOutcome] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    setIsMobile(isMobileDevice());
  }, []);
  
  const [regGst, setRegGst] = useState(false);
  const [regPan, setRegPan] = useState(false);
  const [regDrug, setRegDrug] = useState(false);
  const [regBill, setRegBill] = useState(false);

  const [instDate, setInstDate] = useState("");
  const [instVersion, setInstVersion] = useState("");
  const [instStaff, setInstStaff] = useState("");
  const [instIssues, setInstIssues] = useState("");

  const [payAmount, setPayAmount] = useState("");
  const [payMode, setPayMode] = useState("Bank Transfer");
  const [payRef, setPayRef] = useState("");

  const [lossReason, setLossReason] = useState("");
  const [reEngageDate, setReEngageDate] = useState("");

  // RBAC
  const canViewDistributors = hasDistOnboarding;
  const canViewRetailers    = hasRetOnboarding;

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

  useEffect(() => { loadLeads(); }, [loadLeads]);

  const handleOpenLead = async (lead: LocalLead) => {
    setSelectedLead(lead);
    setErrorMsg(null);
    setSuccessMsg(null);
    setShowCallOutcome(false);
    const logs = await db.call_logs.where("lead_id").equals(lead.lead_id).toArray();
    setCallLogs(logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));

    // Load Stage Data
    const reg = await db.table('lead_registration_checklist').where('lead_id').equals(lead.lead_id).first();
    setRegGst(reg?.gst_certificate_uploaded || false);
    setRegPan(reg?.pan_uploaded || false);
    setRegDrug(reg?.drug_licence_uploaded || false);
    setRegBill(reg?.bill_photo_uploaded || false);

    const inst = await db.table('lead_installation_details').where('lead_id').equals(lead.lead_id).first();
    setInstDate(inst?.installation_date || "");
    setInstVersion(inst?.software_version || "");
    setInstStaff(inst?.staff_trained_count?.toString() || "");
    setInstIssues(inst?.issues_encountered || "");

    const pay = await db.table('lead_payment_details').where('lead_id').equals(lead.lead_id).first();
    setPayAmount(pay?.amount?.toString() || "");
    setPayMode(pay?.payment_mode || "Bank Transfer");
    setPayRef(pay?.receipt_url || ""); // Using receipt_url or reference_no depending on schema. We will use reference_no internally for this.
    
    setLossReason("");
    setReEngageDate(lead.re_engage_after || "");
  };

  const handleCloseLead = () => { setSelectedLead(null); setCallLogs([]); };

  // ── Stage transition — open gate if required ─────────────────────────────
  const handleRequestTransition = (lead: LocalLead, targetStatus: LeadStatus) => {
    if (lead.status === targetStatus) return;
    if (!validateLeadStatusTransition(lead.status, targetStatus)) {
      setErrorMsg(`Transition from "${lead.status}" → "${targetStatus}" is not permitted.`);
      return;
    }
    setErrorMsg(null);
    const gateKey = `${lead.status}→${targetStatus}` as GateKey;
    const config  = STAGE_GATES[gateKey];
    if (config) {
      setGateNote("");
      setGateModal({ lead, targetStatus, config });
    } else {
      // No gate required — transition immediately
      executeTransition(lead, targetStatus, null);
    }
  };

  // ── Execute stage transition + optional call log ─────────────────────────
  const executeTransition = async (lead: LocalLead, targetStatus: LeadStatus, note: string | null) => {
    setGateLoading(true);
    try {
      const now = new Date().toISOString();

      // Save gate note as a call log entry
      if (note && note.trim()) {
        const gateKey = `${lead.status}→${targetStatus}` as GateKey;
        const gateLabel = STAGE_GATES[gateKey]?.label || "Stage note";
        const logEntry: LocalCallLog = {
          log_id:             crypto.randomUUID(),
          user_id:            currentUser?.user_id || "system",
          lead_id:            lead.lead_id,
          timestamp:          now,
          outcome:            `[${gateLabel}] → ${targetStatus}`,
          notes:              note.trim(),
          next_followup_date: null,
        };
        await db.call_logs.add(logEntry);
        await db.sync_queue.add({ idempotency_key: crypto.randomUUID(),  table_name: "call_logs", action: "INSERT", data: logEntry, timestamp: now });
      }

      // Update lead status
      const updateData: any = { status: targetStatus };
      if (targetStatus === "Installation") updateData.onboarded_at = now;
      if (targetStatus === "Not Interested" && reEngageDate) updateData.re_engage_after = reEngageDate;
      
      await db.leads.update(lead.lead_id, updateData);
      await db.sync_queue.add({ idempotency_key: crypto.randomUUID(),  table_name: "leads", action: "UPDATE", data: { lead_id: lead.lead_id, ...updateData }, timestamp: now });

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

  // ── Gate modal submit ────────────────────────────────────────────────────
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

  // ── Log extra call outcome ───────────────────────────────────────────────
  const [callOutcome, setCallOutcome] = useState("");
  const [callNotes,   setCallNotes]   = useState("");
  const [followup,    setFollowup]    = useState("");

  const handleAddCallLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedLead || !callOutcome.trim()) return;
    try {
      const log: LocalCallLog = {
        log_id:             crypto.randomUUID(),
        user_id:            currentUser?.user_id || "system",
        lead_id:            selectedLead.lead_id,
        timestamp:          new Date().toISOString(),
        outcome:            callOutcome.trim(),
        notes:              callNotes.trim(),
        next_followup_date: followup || null,
      };
      await db.call_logs.add(log);
      await db.sync_queue.add({ idempotency_key: crypto.randomUUID(),  table_name: "call_logs", action: "INSERT", data: log, timestamp: new Date().toISOString() });
      const logs = await db.call_logs.where("lead_id").equals(selectedLead.lead_id).toArray();
      setCallLogs(logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
      setCallOutcome(""); setCallNotes(""); setFollowup("");
      setSuccessMsg("Call logged."); setTimeout(() => setSuccessMsg(null), 2000);
    } catch (err) { setErrorMsg("Failed to log call."); }
  };

  // ── Create lead ──────────────────────────────────────────────────────────
  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!newBusinessName.trim() || !newContactPerson.trim() || !newPhone.trim()) {
      setErrorMsg("Fill in all fields.");
      return;
    }
    try {
      const lead: LocalLead = {
        lead_id:        crypto.randomUUID(),
        business_name:  newBusinessName.trim(),
        contact_person: newContactPerson.trim(),
        phone:          newPhone.trim(),
        segment_type:   newSegmentType,
        status:         "New",
        lead_source:    newLeadSource,
        lead_source_other: newLeadSource === "Other" ? newLeadSourceOther.trim() : undefined,
        area:           newArea.trim() || undefined,
        assigned_to:    currentUser?.user_id || "unassigned",
        created_at:     new Date().toISOString(),
      };
      await db.leads.add(lead);
      await db.sync_queue.add({ idempotency_key: crypto.randomUUID(),  table_name: "leads", action: "INSERT", data: lead, timestamp: new Date().toISOString() });
      setNewBusinessName(""); setNewContactPerson(""); setNewPhone(""); setNewArea(""); setNewLeadSource("Cold Call"); setNewLeadSourceOther("");
      setShowAddModal(false);
      await loadLeads();
      setSuccessMsg("Lead created."); setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err) { setErrorMsg("Failed to create lead."); }
  };

  // ── Visible leads ────────────────────────────────────────────────────────
  const visibleLeads = leads.filter(l => {
    if (l.segment_type !== segmentTab) return false;
    if (l.segment_type === "Distributor" && !canViewDistributors) return false;
    if (l.segment_type === "Retailer"    && !canViewRetailers)    return false;
    return true;
  });

  const getDaysAge = (createdAt: string) => {
    const days = Math.ceil((Date.now() - new Date(createdAt).getTime()) / 86400000);
    return days === 1 ? "1d" : `${days}d`;
  };

  const stageMeta = (code: LeadStatus) => STAGE_META.find(s => s.code === code) ?? STAGE_META[0];

  if (!hasOnboarding) {
    return (
      <div className="max-w-md mx-auto mt-16 p-8 bg-white rounded-3xl border border-slate-100 shadow-sm text-center space-y-4">
        <AlertCircle size={40} className="mx-auto text-status-error" />
        <h3 className="text-lg font-black text-slate-900">Access Restricted</h3>
        <p className="text-xs text-slate-500 font-semibold">You don't have an Onboarding capability assigned.</p>
      </div>
    );
  }

  return (
      <div className="space-y-5 h-full flex flex-col min-w-0 overflow-hidden w-full">
        {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-slate-900">Pipeline</h2>
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Stage-gated sales funnel</p>
        </div>

        <div className="flex items-center gap-3">
          {/* Segment tabs */}
          <div className="flex bg-white/70 p-1.5 rounded-2xl border border-slate-200/40 shadow-sm">
            {canViewRetailers && (
              <button onClick={() => setSegmentTab("Retailer")}
                className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${segmentTab === "Retailer" ? "bg-brand-primary text-white shadow-md" : "text-slate-600 hover:text-brand-primary"}`}>
                Retailers
              </button>
            )}
            {canViewDistributors && (
              <button onClick={() => setSegmentTab("Distributor")}
                className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${segmentTab === "Distributor" ? "bg-brand-primary text-white shadow-md" : "text-slate-600 hover:text-brand-primary"}`}>
                Distributors
              </button>
            )}
          </div>

          <button onClick={() => { setNewSegmentType(segmentTab); setShowAddModal(true); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-brand-primary text-white rounded-xl text-xs font-black shadow-md shadow-brand-primary/20 hover:bg-brand-secondary transition-all cursor-pointer">
            <Plus size={14} /> New Lead
          </button>
        </div>
      </div>

      {/* Feedback */}
      {successMsg && <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-700 text-xs font-bold">✓ {successMsg}</div>}
      {errorMsg   && <div className="p-3 bg-rose-50 border border-rose-200 rounded-2xl text-rose-600 text-xs font-bold flex gap-2 items-center"><AlertCircle size={14}/>{errorMsg}</div>}

      {/* Funnel summary bar */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {KANBAN_STAGES.map(stage => {
          const count = visibleLeads.filter(l => l.status === stage.code).length;
          return (
            <div key={stage.code} className={`shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-bold ${stage.color}`}>
              <span className={`h-2 w-2 rounded-full ${stage.dot}`} />
              {stage.display}
              <span className="font-black">{count}</span>
            </div>
          );
        })}
      </div>

      {/* ── Kanban Board ── */}
      <div className="w-full overflow-x-auto flex-1 min-h-0">
        <div className="flex gap-4 min-w-max px-1 pb-6 h-full">
        {KANBAN_STAGES.map(stage => {
          const stageLeads = visibleLeads.filter(l => l.status === stage.code);
          return (
            <div key={stage.code} className="w-[300px] shrink-0 flex flex-col">
              <div className={`flex items-center justify-between mb-3 px-3 py-2.5 rounded-2xl border ${stage.color}`}>
                <div className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${stage.dot}`} />
                  <h3 className="font-black text-slate-900 text-xs">{stage.display}</h3>
                </div>
                <span className="bg-white/60 px-2 py-0.5 rounded-full text-[10px] font-black text-slate-600 border border-white/40">
                  {stageLeads.length}
                </span>
              </div>

              <div className="space-y-2.5 flex-1 overflow-y-auto max-h-[64vh] pr-0.5">
                {stageLeads.map(lead => (
                  <div key={lead.lead_id} onClick={() => handleOpenLead(lead)}
                    className="group bg-white p-4 rounded-2xl border border-slate-100 shadow-sm hover:border-brand-primary/30 hover:shadow-md transition-all cursor-pointer">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h4 className="font-black text-slate-900 text-sm leading-snug group-hover:text-brand-primary transition-colors flex-1">
                        {lead.business_name}
                      </h4>
                      <span className="text-[9px] text-slate-400 font-bold shrink-0">{getDaysAge(lead.created_at)}</span>
                    </div>
                    <p className="text-[11px] text-slate-400 font-medium truncate">{lead.contact_person}</p>
                    <div className="flex items-center gap-1 mt-2 text-slate-400">
                      <Phone size={10} />
                      <span className="text-[10px] font-semibold">{lead.phone}</span>
                    </div>
                  </div>
                ))}
                {stageLeads.length === 0 && (
                  <div className="border border-dashed border-slate-200 rounded-2xl py-8 text-center bg-white/40">
                    <FolderOpen size={22} className="mx-auto text-slate-300 mb-1.5" />
                    <p className="text-[11px] text-slate-400 font-bold">Empty</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        </div>
      </div>

      {/* ── CREATE LEAD MODAL ── */}
      {showAddModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[110] p-4">
          <div className="bg-white rounded-3xl border border-slate-100 max-w-md w-full shadow-2xl p-6 space-y-5 relative">
            <button onClick={() => setShowAddModal(false)} className="absolute right-4 top-4 text-slate-400 hover:text-slate-600 cursor-pointer">
              <X size={20} />
            </button>
            <div>
              <h3 className="text-lg font-black text-slate-900">New Lead</h3>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">Register a new pipeline lead</p>
            </div>
            <form onSubmit={handleCreateLead} className="space-y-4">
              {[
                { label: "Business Name",    value: newBusinessName,   setter: setNewBusinessName,   placeholder: "e.g. Elite Electronics" },
                { label: "Contact Person",   value: newContactPerson,  setter: setNewContactPerson,  placeholder: "e.g. Rajesh Kumar" },
                { label: "Phone Number",     value: newPhone,          setter: setNewPhone,          placeholder: "e.g. 9876543210" },
                { label: "Area / Location",  value: newArea,           setter: setNewArea,           placeholder: "e.g. North District" },
              ].map(f => (
                <div key={f.label}>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">{f.label}</label>
                  <input required type="text" value={f.value} onChange={e => f.setter(e.target.value)} placeholder={f.placeholder}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 placeholder-slate-300 focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10 transition-all" />
                </div>
              ))}
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Lead Source</label>
                <select value={newLeadSource} onChange={e => setNewLeadSource(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10 transition-all">
                  {['Referral','Cold Call','Inbound Inquiry','Social Media','Field Visit','Other'].map(src => (
                    <option key={src} value={src}>{src}</option>
                  ))}
                </select>
                {newLeadSource === "Other" && (
                  <div className="mt-2">
                    <input
                      required
                      type="text"
                      value={newLeadSourceOther}
                      onChange={e => setNewLeadSourceOther(e.target.value)}
                      placeholder="Please specify..."
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 placeholder-slate-300 focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10 transition-all"
                    />
                  </div>
                )}
              </div>
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">Segment</label>
                <div className="flex gap-2">
                  {(["Retailer", "Distributor"] as const).map(s => (
                    <button key={s} type="button" onClick={() => setNewSegmentType(s)}
                      className={`flex-1 py-2.5 rounded-xl text-xs font-black border transition-all ${newSegmentType === s ? "bg-brand-primary text-white border-brand-primary" : "bg-white border-slate-200 text-slate-500 hover:border-brand-primary/30"}`}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <button type="submit"
                className="w-full py-3.5 bg-brand-primary hover:bg-brand-secondary text-white font-black rounded-2xl transition-all shadow-lg shadow-brand-primary/20 text-xs uppercase tracking-wider cursor-pointer">
                Create Lead →
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── STAGE GATE MODAL ── */}
      {gateModal && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center z-[110] p-4">
          <div className="bg-white rounded-3xl border border-slate-100 max-w-md w-full shadow-2xl p-6 space-y-5">
            {/* Header */}
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Lock size={16} className="text-brand-primary" />
                  <span className="text-[10px] font-black text-brand-primary uppercase tracking-widest">Stage Gate</span>
                </div>
                <h3 className="text-lg font-black text-slate-900">{gateModal.config.label}</h3>
                <p className="text-xs text-slate-400 font-semibold mt-0.5">
                  Moving <strong className="text-slate-700">{gateModal.lead.business_name}</strong> → <span className={`font-black ${stageMeta(gateModal.targetStatus).dot.replace("bg-", "text-")}`}>{gateModal.targetStatus}</span>
                </p>
              </div>
              <button onClick={() => { setGateModal(null); setGateNote(""); }} className="text-slate-400 hover:text-slate-600 cursor-pointer mt-1">
                <X size={18} />
              </button>
            </div>

            {/* Stage transition visual */}
            <div className="flex items-center gap-2 p-3 bg-slate-50 rounded-2xl border border-slate-100">
              <span className={`px-3 py-1 rounded-full text-[10px] font-black border ${stageMeta(gateModal.lead.status).color}`}>
                {gateModal.lead.status}
              </span>
              <ArrowRight size={14} className="text-slate-400 shrink-0" />
              <span className={`px-3 py-1 rounded-full text-[10px] font-black border ${stageMeta(gateModal.targetStatus).color}`}>
                {gateModal.targetStatus}
              </span>
            </div>

            {errorMsg && (
              <div className="flex gap-2 items-center p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-600 text-xs font-semibold">
                <AlertCircle size={13} />{errorMsg}
              </div>
            )}

            <form onSubmit={handleGateSubmit} className="space-y-4">
              <div>
                <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                  {gateModal.config.label} <span className="text-rose-400">*</span>
                </label>
                <textarea
                  rows={3}
                  value={gateNote}
                  onChange={e => setGateNote(e.target.value)}
                  placeholder={gateModal.config.placeholder}
                  required={gateModal.config.required}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 placeholder-slate-300 focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10 transition-all resize-none"
                  autoFocus
                />
                <p className="text-[10px] text-slate-400 mt-1 font-semibold">This will be saved as a call log entry for audit trail.</p>
              </div>

              {gateModal.targetStatus === "Not Interested" && (
                <div>
                  <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                    Re-engage After (Optional)
                  </label>
                  <input type="date" value={reEngageDate} onChange={e => setReEngageDate(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-900 focus:outline-none focus:border-brand-primary transition-all" />
                </div>
              )}

              <div className="flex gap-3">
                <button type="button" onClick={() => { setGateModal(null); setGateNote(""); setErrorMsg(null); }}
                  className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 font-black rounded-2xl text-xs transition-all cursor-pointer">
                  Cancel
                </button>
                <button type="submit" disabled={gateLoading}
                  className="flex-1 flex items-center justify-center gap-2 py-3 bg-brand-primary hover:bg-brand-secondary text-white font-black rounded-2xl text-xs transition-all shadow-md shadow-brand-primary/10 cursor-pointer disabled:opacity-50">
                  <CheckCircle2 size={14} />
                  {gateLoading ? "Moving…" : "Confirm & Move"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── LEAD DETAIL DRAWER ── */}
      {selectedLead && (
        <div className="fixed inset-y-0 right-0 max-w-md w-full bg-white border-l border-slate-200 shadow-2xl z-[100] flex flex-col">
          {/* Header */}
          <div className="p-5 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
            <div>
              <span className={`text-[9px] uppercase font-black px-2 py-0.5 rounded border ${stageMeta(selectedLead.status).color}`}>
                {selectedLead.status}
              </span>
              <h3 className="text-base font-black text-slate-900 mt-1">{selectedLead.business_name}</h3>
              <p className="text-xs text-slate-400 font-semibold">{selectedLead.contact_person} · {selectedLead.phone}</p>
            </div>
            <button onClick={handleCloseLead} className="p-2 rounded-xl border border-slate-200 text-slate-400 hover:text-slate-600 cursor-pointer bg-white">
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-5">
            {/* ── PROGRESSIVE DISCLOSURE ACTIONS ── */}
            <div>
              {(selectedLead.status === "New" || selectedLead.status === "Contacted") && (
                <div className="space-y-3">
                  {isMobile ? (
                    <a href={`tel:${selectedLead.phone}`} onClick={() => setShowCallOutcome(true)}
                       className="block w-full text-center py-3 rounded-xl bg-brand-primary text-white font-black text-xs uppercase tracking-wider hover:bg-brand-secondary transition-all shadow-md shadow-brand-primary/20">
                       📞 Call {selectedLead.contact_person}
                    </a>
                  ) : (
                    <button onClick={() => setShowCallOutcome(true)}
                       className="block w-full text-center py-3 rounded-xl bg-brand-primary text-white font-black text-xs uppercase tracking-wider hover:bg-brand-secondary transition-all shadow-md shadow-brand-primary/20">
                       📞 {selectedLead.phone} — Log call outcome
                    </button>
                  )}
                  {showCallOutcome && (
                    <div className="grid grid-cols-2 gap-2 mt-3 p-3 bg-slate-50 border border-slate-100 rounded-xl">
                      {["No Answer", "Call Back Later", "Interested", "Not Interested"].map((outcome) => (
                        <button key={outcome}
                          onClick={async () => {
                            let currentLead = selectedLead;
                            
                            // STEP 1 — always log the call first. If the lead is still "New", this
                            // is the ONLY hop allowed from New, and it's always valid.
                            if (currentLead.status === "New") {
                              const updatedFields = { status: "Contacted" as const };
                              await db.leads.update(currentLead.lead_id, updatedFields);
                              await db.sync_queue.add({ idempotency_key: crypto.randomUUID(),  table_name: "leads", action: "UPDATE", data: { lead_id: currentLead.lead_id, ...updatedFields }, timestamp: new Date().toISOString() });
                              currentLead = { ...currentLead, ...updatedFields };
                              setSelectedLead(currentLead);
                              await loadLeads();
                            }

                            // STEP 2 — record the call itself (existing call_logs insert logic)
                            const log: LocalCallLog = {
                              log_id: crypto.randomUUID(),
                              user_id: currentUser?.user_id || "system",
                              lead_id: currentLead.lead_id,
                              timestamp: new Date().toISOString(),
                              outcome: outcome,
                              notes: "",
                              next_followup_date: null,
                            };
                            await db.call_logs.add(log);
                            await db.sync_queue.add({ idempotency_key: crypto.randomUUID(),  table_name: "call_logs", action: "INSERT", data: log, timestamp: log.timestamp });
                            const logs = await db.call_logs.where("lead_id").equals(currentLead.lead_id).toArray();
                            setCallLogs(logs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));

                            // STEP 3 — chain the SECOND hop from Contacted, only for outcomes that
                            // actually move the stage. This hop is validated exactly like every
                            // other transition.
                            if (outcome === "Interested") {
                              handleRequestTransition(currentLead, "Interested");
                            } else if (outcome === "Not Interested") {
                              handleRequestTransition(currentLead, "Not Interested");
                            }
                            
                            setShowCallOutcome(false);
                          }}
                          className="py-2.5 rounded-lg border border-slate-200 bg-white text-xs font-black text-slate-600 hover:border-brand-primary/40 hover:text-brand-primary transition-all">
                          {outcome}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {selectedLead.status === "Interested" && (
                <div className="space-y-3">
                   <button onClick={() => handleRequestTransition(selectedLead, "Registration")}
                     className="w-full py-3 bg-brand-primary text-white rounded-xl text-xs font-black uppercase tracking-wider hover:bg-brand-secondary shadow-md shadow-brand-primary/20 transition-all">
                     Move to Registration →
                   </button>
                   <button onClick={() => handleRequestTransition(selectedLead, "Not Interested")}
                     className="w-full py-3 bg-white border border-rose-200 text-rose-500 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-rose-50 transition-all">
                     Mark Not Interested
                   </button>
                </div>
              )}

              {selectedLead.status === "Registration" && (
                <div className="space-y-4 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Document Checklist</h4>
                  <div className="space-y-2">
                    {[
                      { key: 'gst', label: 'GST Certificate Uploaded', val: regGst, setter: setRegGst },
                      { key: 'pan', label: 'PAN Card Uploaded', val: regPan, setter: setRegPan },
                      { key: 'drug', label: 'Drug Licence Uploaded', val: regDrug, setter: setRegDrug },
                      { key: 'bill', label: 'Bill Photo Uploaded', val: regBill, setter: setRegBill },
                    ].map(chk => (
                      <label key={chk.key} className="flex items-center gap-3 p-2 hover:bg-white rounded-lg cursor-pointer transition-colors border border-transparent hover:border-slate-200">
                        <input type="checkbox" checked={chk.val} onChange={(e) => chk.setter(e.target.checked)} className="w-4 h-4 rounded text-brand-primary border-slate-300 focus:ring-brand-primary" />
                        <span className="text-xs font-bold text-slate-700">{chk.label}</span>
                      </label>
                    ))}
                  </div>
                  <button 
                    disabled={!regGst || !regPan || !regDrug || !regBill}
                    onClick={async () => {
                      const data = { checklist_id: crypto.randomUUID(), lead_id: selectedLead.lead_id, gst_certificate_uploaded: regGst, pan_uploaded: regPan, drug_licence_uploaded: regDrug, bill_photo_uploaded: regBill, updated_at: new Date().toISOString() };
                      const existing = await db.table('lead_registration_checklist').where('lead_id').equals(selectedLead.lead_id).first();
                      if (existing) {
                        data.checklist_id = existing.checklist_id;
                        await db.table('lead_registration_checklist').update(existing.checklist_id, data);
                        await db.sync_queue.add({ idempotency_key: crypto.randomUUID(),  table_name: "lead_registration_checklist", action: "UPDATE", data, timestamp: data.updated_at });
                      } else {
                        await db.table('lead_registration_checklist').add(data);
                        await db.sync_queue.add({ idempotency_key: crypto.randomUUID(),  table_name: "lead_registration_checklist", action: "INSERT", data, timestamp: data.updated_at });
                      }
                      handleRequestTransition(selectedLead, "Installation");
                    }}
                    className="w-full py-3 bg-brand-primary text-white rounded-xl text-xs font-black uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed hover:bg-brand-secondary shadow-md shadow-brand-primary/20 transition-all"
                    title={(!regGst || !regPan || !regDrug || !regBill) ? "Complete all documents first" : ""}>
                    Move to Installation →
                  </button>
                </div>
              )}

              {selectedLead.status === "Installation" && (
                <div className="space-y-4 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Installation Details</h4>
                  <div className="space-y-2.5">
                    <input type="date" value={instDate} onChange={e => setInstDate(e.target.value)} className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:border-brand-primary focus:outline-none" title="Installation Date" />
                    <input type="text" placeholder="Software Version" value={instVersion} onChange={e => setInstVersion(e.target.value)} className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:border-brand-primary focus:outline-none" />
                    <input type="number" placeholder="Staff Trained Count" value={instStaff} onChange={e => setInstStaff(e.target.value)} className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:border-brand-primary focus:outline-none" />
                    <textarea placeholder="Issues encountered..." value={instIssues} onChange={e => setInstIssues(e.target.value)} className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 resize-none h-16 focus:border-brand-primary focus:outline-none" />
                  </div>
                  <button 
                    disabled={!instDate || !instVersion || !instStaff}
                    onClick={async () => {
                      const data = { installation_id: crypto.randomUUID(), lead_id: selectedLead.lead_id, installation_date: instDate, software_version: instVersion, staff_trained_count: parseInt(instStaff) || 0, issues_encountered: instIssues, created_at: new Date().toISOString() };
                      const existing = await db.table('lead_installation_details').where('lead_id').equals(selectedLead.lead_id).first();
                      if (existing) {
                        data.installation_id = existing.installation_id;
                        await db.table('lead_installation_details').update(existing.installation_id, data);
                        await db.sync_queue.add({ idempotency_key: crypto.randomUUID(),  table_name: "lead_installation_details", action: "UPDATE", data, timestamp: data.created_at });
                      } else {
                        await db.table('lead_installation_details').add(data);
                        await db.sync_queue.add({ idempotency_key: crypto.randomUUID(),  table_name: "lead_installation_details", action: "INSERT", data, timestamp: data.created_at });
                      }
                      handleRequestTransition(selectedLead, "Payment");
                    }}
                    className="w-full py-3 bg-brand-primary text-white rounded-xl text-xs font-black uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed hover:bg-brand-secondary shadow-md shadow-brand-primary/20 transition-all">
                    Move to Payment →
                  </button>
                </div>
              )}

              {selectedLead.status === "Payment" && (
                <div className="space-y-4 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                  <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Payment Details</h4>
                  <div className="space-y-2.5">
                    <input type="number" placeholder="Amount" value={payAmount} onChange={e => setPayAmount(e.target.value)} className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:border-brand-primary focus:outline-none" />
                    <select value={payMode} onChange={e => setPayMode(e.target.value)} className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:border-brand-primary focus:outline-none">
                      {['Bank Transfer','UPI','Cheque','Cash'].map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <input type="text" placeholder="Reference Number" value={payRef} onChange={e => setPayRef(e.target.value)} className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 focus:border-brand-primary focus:outline-none" />
                  </div>
                  <button 
                    disabled={!payAmount}
                    onClick={async () => {
                      const data = { payment_id: crypto.randomUUID(), lead_id: selectedLead.lead_id, amount: parseFloat(payAmount), payment_mode: payMode, receipt_url: payRef, paid_at: new Date().toISOString() };
                      const existing = await db.table('lead_payment_details').where('lead_id').equals(selectedLead.lead_id).first();
                      if (existing) {
                        data.payment_id = existing.payment_id;
                        await db.table('lead_payment_details').update(existing.payment_id, data);
                        await db.sync_queue.add({ idempotency_key: crypto.randomUUID(),  table_name: "lead_payment_details", action: "UPDATE", data, timestamp: data.paid_at });
                      } else {
                        await db.table('lead_payment_details').add(data);
                        await db.sync_queue.add({ idempotency_key: crypto.randomUUID(),  table_name: "lead_payment_details", action: "INSERT", data, timestamp: data.paid_at });
                      }
                      setSuccessMsg("Payment details saved.");
                      handleCloseLead();
                    }}
                    className="w-full py-3 bg-brand-primary text-white rounded-xl text-xs font-black uppercase tracking-wider disabled:opacity-50 disabled:cursor-not-allowed hover:bg-brand-secondary shadow-md shadow-brand-primary/20 transition-all">
                    Mark as Paid ✓
                  </button>
                </div>
              )}
            </div>

            {/* Lead info */}
            <div className="bg-slate-50 rounded-2xl border border-slate-100 p-4 space-y-2 text-xs">
              <p className="font-black text-[10px] text-slate-400 uppercase tracking-widest mb-2">Lead Profile</p>
              {[
                { k: "Business",  v: selectedLead.business_name },
                { k: "Contact",   v: selectedLead.contact_person },
                { k: "Phone",     v: selectedLead.phone },
                { k: "Segment",   v: selectedLead.segment_type },
                { k: "Source",    v: selectedLead.lead_source === "Other" && selectedLead.lead_source_other ? `Other: ${selectedLead.lead_source_other}` : selectedLead.lead_source },
                { k: "Area",      v: selectedLead.area },
                { k: "Registered",v: new Date(selectedLead.created_at).toLocaleDateString() },
              ].map(row => row.v ? (
                <div key={row.k} className="flex justify-between border-b border-slate-100 pb-1.5 last:border-0 last:pb-0">
                  <span className="text-slate-400 font-bold">{row.k}</span>
                  <span className="font-semibold text-slate-900">{row.v}</span>
                </div>
              ) : null)}
            </div>

            {/* Call log history */}
            {callLogs.length > 0 && (
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Interaction History ({callLogs.length})</p>
                <div className="space-y-2.5">
                  {callLogs.map(log => (
                    <div key={log.log_id} className="p-3.5 bg-white border border-slate-100 rounded-xl space-y-1">
                      <div className="flex justify-between text-[10px] text-slate-400 font-bold">
                        <span className="font-black text-slate-700">{log.outcome}</span>
                        <span>{new Date(log.timestamp).toLocaleDateString()}</span>
                      </div>
                      {log.notes && <p className="text-[11px] text-slate-500 italic">"{log.notes}"</p>}
                      {log.next_followup_date && (
                        <p className="text-[9px] text-brand-primary font-black uppercase">
                          Follow up: {new Date(log.next_followup_date).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      </div>
  );
}
