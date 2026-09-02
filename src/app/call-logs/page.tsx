"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { claimSyncQueueOwnership, confirmQueuedCallLog, db, processSyncQueue, processSyncQueueExcept, queueCallOwnerUpdate, LocalCallLog, LocalUser, LocalLead } from "@/lib/db";
import { SearchableSelect, SearchableOption } from "@/components/SearchableSelect";
import { PhoneCall, CheckCircle2, AlertCircle, Download } from "lucide-react";
import excelUsers from "@/lib/excel_users.json";
import { buildCanonicalClientOptions } from "@/lib/clientOptions";
import { exportCallLogs } from "@/lib/excelExport";
import { parseCallClientReference } from "@/lib/callLogs/contract";
import { QueueList } from "@/components/QueueList";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { MetricCard } from "@/components/ui/MetricCard";
import { getCurrentISTDate, getISTDateKey } from "@/lib/dateTime";
import { buildSelfScheduledFollowUpTask, needsCallFollowUp, parseFollowUpSourceCallId, reconcileCallFollowUpTasks } from "@/lib/followUps";
import { CALL_LOGS_CHANGED_EVENT, fetchCallLogSnapshot, formatCallHistoryCount } from "@/lib/callLogs/repository";
import { getCanonicalDailyUserMetrics, isGenuineCallLog, isSyntheticAuditCall } from "@/lib/workMetrics/canonical";

export default function CallLogsPage() {
  const { currentUser, isAdmin } = useAuth();

  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<LocalCallLog[]>([]);
  const [confirmedLogs, setConfirmedLogs] = useState<LocalCallLog[]>([]);
  const [usersMap, setUsersMap] = useState<Map<string, LocalUser>>(new Map());
  const [leadsMap, setLeadsMap] = useState<Map<string, LocalLead>>(new Map());
  const [followUpTaskIds, setFollowUpTaskIds] = useState<Set<string>>(new Set());
  const [genuineCallIdsToday, setGenuineCallIdsToday] = useState<Set<string>>(new Set());
  const [followupCallIdsToday, setFollowupCallIdsToday] = useState<Set<string>>(new Set());
  const [reachedCallIdsToday, setReachedCallIdsToday] = useState<Set<string>>(new Set());
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);
  const [lifetimeConfirmedTotal, setLifetimeConfirmedTotal] = useState<number | null>(null);
  const [pendingSyncCount, setPendingSyncCount] = useState(0);
  const [historyAuthoritative, setHistoryAuthoritative] = useState(false);

  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [pipelineLeadOption, setPipelineLeadOption] = useState<SearchableOption | null>(null);
  const [outcome, setOutcome] = useState("");
  const [notes, setNotes] = useState("");
  const [nextFollowup, setNextFollowup] = useState("");
  const [editingLog, setEditingLog] = useState<LocalCallLog | null>(null);

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
    const options = buildCanonicalClientOptions(excelUsers as Array<{ username: string; name?: string }>);
    return pipelineLeadOption && !options.some((option) => option.value === pipelineLeadOption.value) ? [pipelineLeadOption, ...options] : options;
  }, [pipelineLeadOption]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const leadId = params.get("lead_id")?.trim() ?? "";
    if (!leadId || !parseCallClientReference(leadId).leadId) return;
    const label = params.get("lead_name")?.trim() || `Pipeline lead ${leadId}`;
    const timer = window.setTimeout(() => {
      setPipelineLeadOption({ value: leadId, label, searchText: leadId });
      setSelectedLeadId(leadId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const loadData = React.useCallback(async (drainQueue = true) => {
    try {
      if (!currentUser) {
        setLogs([]);
        return;
      }
      if (drainQueue && navigator.onLine) void processSyncQueue().catch(() => console.warn("Background sync remains pending during call-history refresh."));
      const snapshot = await fetchCallLogSnapshot(currentUser.user_id, isAdmin);
      const fetchedLogs = snapshot.logs;
      setHistoryNotice(snapshot.notice);
      setLifetimeConfirmedTotal(snapshot.lifetimeConfirmedTotal);
      setPendingSyncCount(snapshot.pendingCount);
      setHistoryAuthoritative(snapshot.authoritative);
      setLogs(fetchedLogs);
      setConfirmedLogs(snapshot.confirmedLogs);

      try {
        const currentLocalUser = isAdmin ? null : await db.users.get(currentUser.user_id);
        const allUsers = isAdmin ? await db.users.toArray() : currentLocalUser ? [currentLocalUser] : [];
        const uMap = new Map<string, LocalUser>();
        allUsers.forEach(u => uMap.set(u.user_id, u));

        const leadIds = [...new Set(fetchedLogs.map((log) => log.lead_id).filter((leadId): leadId is string => Boolean(leadId)))];
        const allLeads = leadIds.length ? await db.leads.where("lead_id").anyOf(leadIds).toArray() : [];
        const lMap = new Map<string, LocalLead>();
        allLeads.forEach(l => lMap.set(l.lead_id, l));
        const visibleCallIds = new Set(fetchedLogs.map((log) => log.log_id));
        const matchingTasks = await db.tasks.where("assigned_to").equals(currentUser.user_id).filter((task) => task.is_active !== false && task.status !== "Completed" && task.status !== "Missed" && visibleCallIds.has(parseFollowUpSourceCallId(task.description) ?? "")).toArray();
        setFollowUpTaskIds(new Set(matchingTasks.map((task) => parseFollowUpSourceCallId(task.description)).filter((id): id is string => Boolean(id))));
        const today = getCurrentISTDate();
        const ownLocalCalls = await db.call_logs.where("user_id").equals(currentUser.user_id).filter((log) => getISTDateKey(log.timestamp) === today).toArray();
        const localTasks = (await db.tasks.bulkGet(ownLocalCalls.map((log) => log.log_id))).filter((task): task is NonNullable<typeof task> => Boolean(task));
        const localMetric = getCanonicalDailyUserMetrics({ userId: currentUser.user_id, calls: ownLocalCalls, tasks: localTasks, taskHistory: [] });
        setGenuineCallIdsToday(new Set([...snapshot.confirmedGenuineCallIds, ...localMetric.genuine_call_ids]));
        setFollowupCallIdsToday(new Set([...snapshot.confirmedFollowupCallIds, ...localMetric.followup_call_ids]));
        const localReachedIds = ownLocalCalls.filter((log) => localMetric.genuine_call_ids.has(log.log_id) && !log.outcome.toLowerCase().includes("no response")).map((log) => log.log_id);
        setReachedCallIdsToday(new Set([...snapshot.confirmedReachedCallIds, ...localReachedIds]));

        setUsersMap(uMap);
        setLeadsMap(lMap);
      } catch {
        console.warn("Call history loaded; optional local display enrichment is unavailable.");
        setHistoryNotice((current) => current ?? "Confirmed call history is visible. Some local labels or derived metrics are temporarily unavailable.");
      }
    } catch (err) {
      console.error("Failed to load logs:", err);
    } finally {
      setLoading(false);
    }
  }, [currentUser, isAdmin]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    const refreshAuthority = () => void loadData(false);
    const refreshOnFocus = () => void loadData();
    window.addEventListener(CALL_LOGS_CHANGED_EVENT, refreshAuthority);
    window.addEventListener("focus", refreshOnFocus);
    return () => {
      window.removeEventListener(CALL_LOGS_CHANGED_EVENT, refreshAuthority);
      window.removeEventListener("focus", refreshOnFocus);
    };
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
      if (editingLog) {
        if (editingLog.user_id !== currentUser.user_id || isSyntheticAuditCall(editingLog)) throw new Error("Only the employee who logged this Call may update it.");
        const updated: LocalCallLog = {
          ...editingLog,
          lead_id: clientReference.leadId,
          client_username: clientReference.clientUsername,
          client_name: clientReference.clientName,
          outcome,
          notes: notes.trim() || null,
          next_followup_date: nextFollowupDate,
        };
        const changedAt = new Date().toISOString();
        const existingTasks = await db.tasks.filter((task) => parseFollowUpSourceCallId(task.description) === editingLog.log_id).toArray();
        const followUpTasks = reconcileCallFollowUpTasks({
          existingTasks,
          outcome,
          dueDate: nextFollowupDate,
          authenticatedUserId: currentUser.user_id,
          newTaskId: crypto.randomUUID(),
          clientDisplay: clientReference.displayName,
          relatedLeadId: clientReference.leadId,
          notes: notes.trim(),
          changedAt,
          sourceCallId: editingLog.log_id,
        });
        await queueCallOwnerUpdate(updated, followUpTasks);
        if (navigator.onLine) await processSyncQueue();
        setEditingLog(null);
        setSelectedLeadId(""); setOutcome(""); setNotes(""); setNextFollowup("");
        setSuccess(true);
        await loadData(false);
        setTimeout(() => setSuccess(false), 3000);
        return;
      }
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
            sourceCallId: logId,
          })
        : null;

      await db.transaction("rw", [db.call_logs, db.tasks, db.sync_queue], async () => {
        await db.call_logs.add(log);
        await db.sync_queue.add({
          idempotency_key: `call-log:${logId}`,
          owner_user_id: claimSyncQueueOwnership(),
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
            owner_user_id: claimSyncQueueOwnership(),
            table_name: "tasks",
            action: "INSERT",
            data: followupTask,
            timestamp: createdAt,
            retry_count: 0,
          });
        }
      });

      // The durable local record is the immediate employee view. Remote
      // authority is reconciled asynchronously without re-reading history just
      // to display the call that was saved above.
      setLogs((current) => [log, ...current.filter((item) => item.log_id !== log.log_id)]);
      setPendingSyncCount((current) => current + 1);
      if (getISTDateKey(log.timestamp) === getCurrentISTDate() && isGenuineCallLog(log)) {
        setGenuineCallIdsToday((current) => new Set(current).add(log.log_id));
        if (!log.outcome.toLowerCase().includes("no response")) {
          setReachedCallIdsToday((current) => new Set(current).add(log.log_id));
        }
      }
      setSuccess(true);

      let remotelyConfirmed = false;
      if (navigator.onLine) {
        remotelyConfirmed = await confirmQueuedCallLog(logId);
        // One background pass handles the follow-up task (if any) and unrelated
        // older work after this exact call has received priority.
        void processSyncQueueExcept(`call-log:${logId}`).catch((syncError) => console.warn("Background sync remains pending:", syncError));
      }

      if (navigator.onLine && !remotelyConfirmed) setError("Call saved safely and will finish syncing automatically.");
      if (!navigator.onLine) setError("Call saved offline and will sync automatically when you reconnect.");

      setSelectedLeadId("");
      setOutcome("");
      setNotes("");
      setNextFollowup("");

      setTimeout(() => setSuccess(false), 3000);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to log call.");
    } finally {
      setSubmitting(false);
    }
  };

  const editCall = (log: LocalCallLog) => {
    if (log.user_id !== currentUser?.user_id || isSyntheticAuditCall(log)) return;
    setEditingLog(log);
    setSelectedLeadId(log.lead_id ?? (log.client_username ? `EXCEL::${log.client_username}::${log.client_name ?? log.client_username}` : log.client_name ?? ""));
    setOutcome(log.outcome);
    setNotes(log.notes ?? "");
    setNextFollowup(log.next_followup_date ?? "");
    setError(""); setSuccess(false);
  };

  const cancelEdit = () => {
    setEditingLog(null);
    setSelectedLeadId(""); setOutcome(""); setNotes(""); setNextFollowup(""); setError("");
  };

  const showFollowup = needsCallFollowUp(outcome);

  // Format identity standard: "{Name} (@{Username}) - {Phone}"
  const getLeadDisplay = (log: LocalCallLog) => {
    if (log.client_name || log.client_username) {
      const name = log.client_name || log.client_username || "Unknown client";
      return log.client_username ? `${name} (@${log.client_username})` : name;
    }
    if (!log.lead_id) return "Client reference unavailable";
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
  const todayLogs = [...new Map(logs.filter((log) => log.user_id === currentUser?.user_id && getISTDateKey(log.timestamp) === todayKey && isGenuineCallLog(log)).map((log) => [log.log_id, log])).values()];
  const callsToday = genuineCallIdsToday.size;
  const followupCallsToday = followupCallIdsToday.size;
  const reachedClients = reachedCallIdsToday.size;
  const unknownAuditLike = confirmedLogs.filter((log) => !isSyntheticAuditCall(log) && /\b(?:pipeline|stage|transition|audit|system[- ]generated)\b/i.test(log.outcome)).length;
  const historyCountDescription = formatCallHistoryCount({ authoritative: historyAuthoritative, lifetimeConfirmedTotal, pendingCount: pendingSyncCount, loadedCount: logs.length });

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
        <MetricCard label="Calls today" value={callsToday} icon={<PhoneCall size={17} />} note="Genuine calls recorded today" />
        <MetricCard label="Follow-up calls today" value={followupCallsToday} icon={<AlertCircle size={17} />} tone="warning" note="Included in Calls today" />
        <MetricCard label="Clients reached" value={reachedClients} icon={<CheckCircle2 size={17} />} tone="success" note="Outcomes other than no response" />
      </div>

      {isAdmin && unknownAuditLike > 0 && <div className="alert-panel alert-panel--warning" role="alert"><AlertCircle size={16} /><span>{unknownAuditLike} unknown audit-like call outcome(s) require classification review.</span></div>}
      {historyNotice && <div className="alert-panel alert-panel--warning" role="status"><AlertCircle size={16} /><span>{historyNotice}</span></div>}

      <div className="workspace-split">
        <section className="surface-panel overflow-hidden" aria-labelledby="log-call-title">
          <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-5">
            <p className="section-kicker">{editingLog ? "Creator update" : "New activity"}</p>
            <h2 id="log-call-title" className="mt-1 section-title">{editingLog ? "Update call outcome" : "Record a call outcome"}</h2>
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
            {success && <div className="alert-panel alert-panel--success" role="status"><CheckCircle2 size={16} className="mt-0.5 shrink-0" /><span>Call saved safely and added to recent history.</span></div>}

            <div className="flex justify-end gap-2 border-t border-[var(--border-subtle)] pt-5">
              {editingLog && <Button type="button" variant="outline" onClick={cancelEdit}>Cancel</Button>}
              <Button type="submit" isLoading={submitting} icon={<PhoneCall size={15} />} disabled={!selectedLeadId || !outcome}>{editingLog ? "Save update" : "Record call"}</Button>
            </div>
          </form>
        </section>

        <QueueList
          title="Recent call history"
          countDescription={historyCountDescription}
          items={logs.map((log) => ({
            id: log.log_id,
            primaryNode: (
              <div>
                <p className="text-[13px] font-semibold leading-snug text-[var(--text-primary)]">{getLeadDisplay(log)}</p>
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">Agent · <span className="normal-case tracking-normal text-[var(--text-secondary)]">{getAgentDisplay(log.user_id)}</span></p>
                {log.notes && <p className="mt-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-primary)] p-2.5 text-[12px] leading-5 text-[var(--text-secondary)]">{log.notes}</p>}
              </div>
            ),
            statusText: isSyntheticAuditCall(log) ? "Pipeline audit" : followUpTaskIds.has(log.log_id) ? "Follow-up call" : log.outcome,
            statusVariant: isSyntheticAuditCall(log) ? "neutral" : "brand",
            timestamp: new Date(log.timestamp).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
            actions: log.user_id === currentUser?.user_id && !isSyntheticAuditCall(log) ? <Button size="sm" variant="outline" onClick={() => editCall(log)}>Update</Button> : undefined,
          }))}
          emptyMessage={loading ? "Loading call activity…" : "No calls have been recorded yet."}
          onRefresh={loadData}
        />
      </div>
    </div>
  );
}
