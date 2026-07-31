"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db, processSyncQueue, LocalCallLog, LocalUser, LocalLead } from "@/lib/db";
import { SearchableSelect, SearchableOption } from "@/components/SearchableSelect";
import { PhoneCall, CheckCircle2, AlertCircle, Download } from "lucide-react";
import excelUsers from "@/lib/excel_users.json";
import { exportCallLogs } from "@/lib/excelExport";
import { parseCallClientReference } from "@/lib/callLogs/contract";
import { QueueList } from "@/components/QueueList";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { MetricCard } from "@/components/ui/MetricCard";
import { getCurrentISTDate, getISTDateKey } from "@/lib/dateTime";
import { buildSelfScheduledFollowUpTask, needsCallFollowUp } from "@/lib/followUps";

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
    const excelOptions: SearchableOption[] = (excelUsers as Array<{ username: string; name?: string }>).map((eu) => ({
      value: `EXCEL::${eu.username}::${eu.name || eu.username}`,
      label: `${eu.name || eu.username} (@${eu.username})`,
      searchText: eu.username + " " + (eu.name || "")
    }));
    return excelOptions.sort((a, b) => a.label.localeCompare(b.label));
  }, []);

  const loadData = React.useCallback(async () => {
    try {
      if (!currentUser) {
        setLogs([]);
        return;
      }
      const fetchedLogs = isAdmin
        ? await db.call_logs.toArray()
        : await db.call_logs.where("user_id").equals(currentUser.user_id).toArray();
      fetchedLogs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      const currentLocalUser = isAdmin ? null : await db.users.get(currentUser.user_id);
      const allUsers = isAdmin ? await db.users.toArray() : currentLocalUser ? [currentLocalUser] : [];
      const uMap = new Map<string, LocalUser>();
      allUsers.forEach(u => uMap.set(u.user_id, u));

      const leadIds = [...new Set(fetchedLogs.map((log) => log.lead_id).filter((leadId): leadId is string => Boolean(leadId)))];
      const allLeads = leadIds.length ? await db.leads.where("lead_id").anyOf(leadIds).toArray() : [];
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
  }, [currentUser, isAdmin]);

  useEffect(() => {
    loadData();
  }, [loadData]);

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
    if (needsCallFollowUp(outcome) && !nextFollowup) {
      setError("Select a next follow-up date before saving this follow-up outcome.");
      return;
    }

    setSubmitting(true);
    setError("");
    setSuccess(false);

    try {
      const nextFollowupDate = needsCallFollowUp(outcome) ? nextFollowup : null;
      const clientReference = parseCallClientReference(selectedLeadId);
      const logId = crypto.randomUUID();
      const taskId = nextFollowupDate ? crypto.randomUUID() : null;
      const createdAt = new Date().toISOString();

      const log: LocalCallLog = {
        log_id: logId,
        user_id: currentUser.user_id,
        lead_id: clientReference.leadId,
        client_username: clientReference.clientUsername,
        client_name: clientReference.clientName,
        timestamp: createdAt,
        outcome: outcome,
        notes: notes.trim() || null,
        next_followup_date: nextFollowupDate,
      };

      const followupTask = taskId
        ? buildSelfScheduledFollowUpTask({
            outcome,
            dueDate: nextFollowupDate,
            authenticatedUserId: currentUser.user_id,
            taskId,
            clientDisplay: clientReference.displayName,
            related_lead_id: clientReference.leadId,
            notes: notes.trim(),
            createdAt,
          })
        : null;

      await db.transaction("rw", [db.call_logs, db.tasks, db.sync_queue], async () => {
        await db.call_logs.add(log);
        await db.sync_queue.add({
          idempotency_key: `call-log:${logId}`,
          table_name: "call_logs",
          action: "INSERT",
          data: log,
          timestamp: createdAt,
          retry_count: 0,
        });
        if (followupTask) {
          await db.tasks.add(followupTask);
          await db.sync_queue.add({
            idempotency_key: `call-followup-task:${logId}`,
            table_name: "tasks",
            action: "INSERT",
            data: followupTask,
            timestamp: createdAt,
            retry_count: 0,
          });
        }
      });
      if (navigator.onLine) void processSyncQueue();

      setSuccess(true);

      setSelectedLeadId("");
      setOutcome("");
      setNotes("");
      setNextFollowup("");

      await loadData();

      setTimeout(() => setSuccess(false), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to log call.");
    } finally {
      setSubmitting(false);
    }
  };

  const showFollowup = needsCallFollowUp(outcome);

  // Format identity standard: "{Name} (@{Username}) - {Phone}"
  const getLeadDisplay = (log: LocalCallLog) => {
    if (log.client_name || log.client_username) {
      const name = log.client_name || log.client_username || "Unknown client";
      return log.client_username ? `${name} (@${log.client_username})` : name;
    }
    if (!log.lead_id) return "Unknown client";
    const lead = leadsMap.get(log.lead_id);
    if (lead) {
      if (lead.business_name.includes("(@")) return lead.business_name;
      return `${lead.business_name} - ${lead.phone || "N/A"}`;
    }
    return log.lead_id;
  };

  const getAgentDisplay = (user_id?: string | null) => {
    if (!user_id) return "System/Unknown";
    const user = usersMap.get(user_id);
    if (!user) return "Unknown Agent";
    return `${user.name} (@${user.email})`;
  };

  const todayKey = getCurrentISTDate();
  const callsToday = logs.filter((log) => getISTDateKey(log.timestamp) === todayKey).length;
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
                <p className="text-[13px] font-semibold leading-snug text-[var(--text-primary)]">{getLeadDisplay(log)}</p>
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
