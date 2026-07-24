"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db, transactionalMutation, LocalCallLog, LocalUser, LocalLead } from "@/lib/db";
import { SearchableSelect, SearchableOption } from "@/components/SearchableSelect";
import { PhoneCall, CheckCircle2, AlertCircle, Download } from "lucide-react";
import excelUsers from "@/lib/excel_users.json";
import { exportCallLogs } from "@/lib/excelExport";
import { QueueList } from "@/components/QueueList";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { MetricCard } from "@/components/ui/MetricCard";

export default function CallLogsPage() {
  const { currentUser, isAdmin } = useAuth();
  
  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<LocalCallLog[]>([]);
  const [usersMap, setUsersMap] = useState<Map<string, LocalUser>>(new Map());
  const [leadsMap, setLeadsMap] = useState<Map<string, LocalLead>>(new Map());
  
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [outcome, setOutcome] = useState("");
  const [notes, setNotes] = useState("");
  const [nextFollowup, setNextFollowup] = useState("");
  
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const commonOutcomes = [
    "No response (followup)",
    "Happy call",
    "Not interested",
    "Requested more info",
    "Wrong Number",
    "Other"
  ];

  const leadOptions: SearchableOption[] = React.useMemo(() => {
    const excelOptions: SearchableOption[] = excelUsers.map((eu: any) => ({
      value: `EXCEL::${eu.username}::${eu.name || eu.username}`,
      label: `${eu.name || eu.username} (@${eu.username})`,
      searchText: eu.username + " " + (eu.name || "")
    }));
    return excelOptions.sort((a, b) => a.label.localeCompare(b.label));
  }, []);

  const loadData = async () => {
    try {
      const fetchedLogs = await db.call_logs.toArray();
      fetchedLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      
      const allUsers = await db.users.toArray();
      const uMap = new Map<string, LocalUser>();
      allUsers.forEach(u => uMap.set(u.user_id, u));
      
      const allLeads = await db.leads.toArray();
      const lMap = new Map<string, LocalLead>();
      allLeads.forEach(l => lMap.set(l.lead_id, l));
      
      setUsersMap(uMap);
      setLeadsMap(lMap);
      setLogs(fetchedLogs);
    } catch (err) {
      console.error("Failed to load logs:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

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
      setError("Please select a call outcome/response.");
      return;
    }

    setSubmitting(true);
    setError("");
    setSuccess(false);

    try {
      const nextFollowupDate = (outcome === "No response (followup)" || outcome === "Requested more info") ? (nextFollowup || null) : null;

      const log: LocalCallLog = {
        log_id: crypto.randomUUID(),
        user_id: currentUser.user_id,
        lead_id: selectedLeadId,
        timestamp: new Date().toISOString(),
        outcome: outcome,
        notes: notes.trim() || null,
        next_followup_date: nextFollowupDate,
      };

      await transactionalMutation("call_logs", "INSERT", log);

      if (nextFollowupDate) {
        const leadNameMatch = selectedLeadId.split("::");
        const leadDisplay = leadNameMatch.length === 3 ? `${leadNameMatch[2]} (@${leadNameMatch[1]})` : selectedLeadId;
        
        const followupTask = {
          task_id: crypto.randomUUID(),
          assigned_to: currentUser.user_id,
          assigned_by: currentUser.user_id,
          title: "Follow-up Call",
          description: `Scheduled follow-up for: ${leadDisplay}\nNotes: ${notes.trim() || "No notes"}`,
          priority: "High" as const,
          status: "Pending" as const,
          source: "manual" as const,
          template_id: null,
          related_lead_id: selectedLeadId,
          due_date: nextFollowupDate,
          started_at: null,
          completed_at: null,
          proof_note: null,
          proof_photo_url: null,
          created_at: new Date().toISOString(),
        };
        await transactionalMutation("tasks", "INSERT", followupTask);
      }

      setSuccess(true);
      
      setSelectedLeadId("");
      setOutcome("");
      setNotes("");
      setNextFollowup("");
      
      await loadData();
      
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message || "Failed to log call.");
    } finally {
      setSubmitting(false);
    }
  };

  const showFollowup = outcome === "No response (followup)" || outcome === "Requested more info";

  // Format identity standard: "{Name} (@{Username}) - {Phone}"
  const getLeadDisplay = (lead_id: string) => {
    if (lead_id.startsWith("EXCEL::")) {
      const parts = lead_id.split("::");
      if (parts.length === 3) {
        return `${parts[2]} (@${parts[1]})`;
      }
    }
    const lead = leadsMap.get(lead_id);
    if (lead) {
      if (lead.business_name.includes("(@")) return lead.business_name;
      return `${lead.business_name} - ${lead.phone || "N/A"}`;
    }
    return lead_id;
  };

  const getAgentDisplay = (user_id?: string | null) => {
    if (!user_id) return "System/Unknown";
    const user = usersMap.get(user_id);
    if (!user) return "Unknown Agent";
    return `${user.name} (@${user.email})`;
  };

  const todayKey = new Date().toISOString().slice(0, 10);
  const callsToday = logs.filter((log) => log.timestamp.startsWith(todayKey)).length;
  const followupsScheduled = logs.filter((log) => Boolean(log.next_followup_date)).length;
  const reachedClients = logs.filter((log) => !log.outcome.toLowerCase().includes("no response")).length;

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Communication desk"
        icon={<PhoneCall size={18} />}
        title="Call activity"
        description="Capture outcomes, schedule follow-ups, and keep a trustworthy history of every client conversation."
        actions={currentUser ? (
          <Button size="sm" variant="outline" onClick={() => exportCallLogs(currentUser.user_id, isAdmin)} icon={<Download size={14} />}>
            Export history
          </Button>
        ) : undefined}
      />

      <div className="metric-grid">
        <MetricCard label="Calls today" value={callsToday} icon={<PhoneCall size={17} />} note="Recorded in the current calendar day" />
        <MetricCard label="Total records" value={logs.length} icon={<CheckCircle2 size={17} />} tone="neutral" note="All locally available call outcomes" />
        <MetricCard label="Follow-ups planned" value={followupsScheduled} icon={<AlertCircle size={17} />} tone="warning" note="Calls with a scheduled next step" />
        <MetricCard label="Clients reached" value={reachedClients} icon={<CheckCircle2 size={17} />} tone="success" note="Outcomes other than no response" />
      </div>

      <div className="workspace-split">
        <section className="surface-panel overflow-hidden" aria-labelledby="log-call-title">
          <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-5">
            <p className="section-kicker">New activity</p>
            <h2 id="log-call-title" className="mt-1 section-title">Record a call outcome</h2>
            <p className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">A follow-up task is created automatically when the selected outcome needs another contact.</p>
          </div>

          <form onSubmit={handleLogCall} className="space-y-5 p-5 sm:p-6">
            <div>
              <label className="field-label">Client or lead</label>
              <SearchableSelect options={leadOptions} value={selectedLeadId} onChange={setSelectedLeadId} placeholder="Search by name or username" required />
            </div>

            <div>
              <label htmlFor="call-outcome" className="field-label">Outcome</label>
              <select id="call-outcome" value={outcome} onChange={(event) => setOutcome(event.target.value)} className="field-control" required>
                <option value="" disabled>Select an outcome</option>
                {commonOutcomes.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>

            <div>
              <label htmlFor="call-notes" className="field-label">Conversation notes <span className="font-normal text-[var(--text-muted)]">(optional)</span></label>
              <textarea id="call-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Important details, objections, or commitments" rows={4} className="field-control resize-y" />
            </div>

            {showFollowup && (
              <Input label="Next follow-up date" type="date" value={nextFollowup} onChange={(event) => setNextFollowup(event.target.value)} description="A high-priority task will be added to My Day." />
            )}

            {error && <div className="alert-panel alert-panel--danger" role="alert"><AlertCircle size={16} className="mt-0.5 shrink-0" /><span>{error}</span></div>}
            {success && <div className="alert-panel alert-panel--success" role="status"><CheckCircle2 size={16} className="mt-0.5 shrink-0" /><span>Call recorded and the activity history is up to date.</span></div>}

            <div className="flex justify-end border-t border-[var(--border-subtle)] pt-5">
              <Button type="submit" isLoading={submitting} icon={<PhoneCall size={15} />} disabled={!selectedLeadId || !outcome}>Record call</Button>
            </div>
          </form>
        </section>

        <QueueList
          title="Recent call history"
          items={logs.map((log) => ({
            id: log.log_id,
            primaryNode: (
              <div>
                <p className="text-[13px] font-semibold leading-snug text-[var(--text-primary)]">{getLeadDisplay(log.lead_id)}</p>
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">Agent · <span className="normal-case tracking-normal text-[var(--text-secondary)]">{getAgentDisplay(log.user_id)}</span></p>
                {log.notes && <p className="mt-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-primary)] p-2.5 text-[12px] leading-5 text-[var(--text-secondary)]">{log.notes}</p>}
              </div>
            ),
            statusText: log.outcome,
            statusVariant: "brand",
            timestamp: new Date(log.timestamp).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
          }))}
          emptyMessage={loading ? "Loading call activity…" : "No calls have been recorded yet."}
          onRefresh={loadData}
        />
      </div>
    </div>
  );
}
