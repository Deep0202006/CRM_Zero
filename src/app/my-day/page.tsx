"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { liveQuery } from "dexie";
import { useAuth } from "@/context/AuthContext";
import {
  getOrGenerateTodayTasks,
  updateTaskStatus,
  sortTasks,
  type LocalTask,
} from "@/lib/taskEngine";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import { claimSyncQueueOwnership, db, processSyncQueue, transactionalMutation, type LocalAllocatedTarget } from "@/lib/db";
import { CheckCircle2, AlertCircle, MapPin, RefreshCw } from "lucide-react";
import { ContextRail } from "@/components/workspace/ContextRail";
import { WorkAgenda, type AgendaView } from "@/components/workspace/WorkAgenda";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { isValidSelfScheduledFollowUp, parseFollowUpSourceCallId, stripInternalFollowUpMarkers } from "@/lib/followUps";
import { getCurrentISTDate, getISTBusinessDayBounds, getISTDateKey } from "@/lib/dateTime";
import { mergePaymentFollowUps, type PaymentFollowUpIdentity } from "@/lib/fieldVisits/paymentFollowUps";
import { getCanonicalDailyUserMetrics } from "@/lib/workMetrics/canonical";
import PaymentCollectionsPriorityPanel from "@/components/PaymentCollectionsPriorityPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { AnalyticsSkeleton } from "@/components/analytics/AnalyticsPanel";

const OwnHistory = dynamic(() => import("@/components/analytics/TeamHistory"), { ssr: false, loading: () => <AnalyticsSkeleton label="Loading your retained history" /> });

interface DailySummary { genuine_calls_today: number; followup_calls_today: number; confirmed_genuine_call_ids: string[]; confirmed_followup_call_ids: string[]; normal_tasks_completed_today: number; followup_tasks_completed_today: number; total_tasks_completed_today: number; pending_followups: number; unique_completed_work: number; generated_at: string; }

export default function MyDayPage() {
  const { currentUser, capabilities, hasOnboarding, hasSupport, isAdmin } = useAuth();
  
  const [tasks, setTasks] = useState<LocalTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [agendaView, setAgendaView] = useState<AgendaView>("Today");
  const [workspaceView, setWorkspaceView] = useState("agenda");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const taskTrigger = useRef<HTMLButtonElement | null>(null);
  const [allocatedTargets, setAllocatedTargets] = useState<LocalAllocatedTarget[]>([]);
  const [targetErrors, setTargetErrors] = useState<Record<string, string>>({});
  const [targetNotice, setTargetNotice] = useState<string | null>(null);
  const [targetLoadError, setTargetLoadError] = useState<string | null>(null);
  const [taskActionMessage, setTaskActionMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [completionDialogTask, setCompletionDialogTask] = useState<LocalTask | null>(null);
  const [completionOutcome, setCompletionOutcome] = useState("Follow-up completed");
  const [deleteDialogTask, setDeleteDialogTask] = useState<LocalTask | null>(null);
  const [dailySummary, setDailySummary] = useState<DailySummary | null>(null);
  const [dailySummaryError, setDailySummaryError] = useState<string | null>(null);
  const [localCallsToday, setLocalCallsToday] = useState(0);
  const [localFollowupCallsToday, setLocalFollowupCallsToday] = useState(0);
  const [paymentFollowUps, setPaymentFollowUps] = useState<PaymentFollowUpIdentity[]>([]);
  const confirmedPaymentFollowUps = useRef<{ date: string; rows: PaymentFollowUpIdentity[] }>({ date: "", rows: [] });

  const refreshDailySummary = useCallback(async () => {
    if (!currentUser) return;
    const today = getCurrentISTDate();
    const localCalls = await db.call_logs.where("user_id").equals(currentUser.user_id).filter((call) => getISTDateKey(call.timestamp) === today).toArray();
    const localTasks = (await db.tasks.bulkGet(localCalls.map((call) => call.log_id))).filter((task): task is NonNullable<typeof task> => Boolean(task));
    const localMetric = getCanonicalDailyUserMetrics({ userId: currentUser.user_id, calls: localCalls, tasks: localTasks, taskHistory: [] });
    setLocalCallsToday(localMetric.genuine_call_ids.size);
    setLocalFollowupCallsToday(localMetric.followup_call_ids.size);
    if (!navigator.onLine || !isSupabaseConfigured) return;
    await processSyncQueue();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    try {
      const response = await fetch("/api/my-day/daily-summary", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!response.ok) throw new Error("Confirmed My Day summary is unavailable.");
      const summary = await response.json() as DailySummary;
      summary.genuine_calls_today = new Set([...(summary.confirmed_genuine_call_ids ?? []), ...localMetric.genuine_call_ids]).size;
      summary.followup_calls_today = new Set([...(summary.confirmed_followup_call_ids ?? []), ...localMetric.followup_call_ids]).size;
      setDailySummary(summary);
      setDailySummaryError(null);
    } catch {
      setDailySummary(null);
      setDailySummaryError("Confirmed My Day metrics could not be loaded. Local operational work remains available below.");
    }
  }, [currentUser]);

  useEffect(() => { void refreshDailySummary(); }, [refreshDailySummary]);

  const refreshPaymentFollowUps = useCallback(async () => {
    if (!currentUser) return;
    const currentDate = getCurrentISTDate();
    const localVisits = await db.field_visits
      .where("user_id")
      .equals(currentUser.user_id)
      .filter((visit) =>
        visit.segment_type === "Distributor" &&
        visit.visit_outcome === "payment_follow_up" &&
        visit.follow_up_date === currentDate &&
        (visit.sync_status === "pending_sync" || visit.sync_status === "sync_failed"),
      )
      .toArray();
    const localLeads = await db.leads.bulkGet([...new Set(localVisits.map((visit) => visit.lead_id))]);
    const leadsById = new Map(localLeads.filter(Boolean).map((lead) => [lead!.lead_id, lead!]));
    let remote = confirmedPaymentFollowUps.current.date === currentDate ? confirmedPaymentFollowUps.current.rows : [];
    if (navigator.onLine && isSupabaseConfigured) {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) {
        const response = await fetch("/api/my-day/payment-followups", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        if (response.ok) {
          const result = await response.json() as { reminders?: PaymentFollowUpIdentity[] };
          remote = result.reminders ?? [];
          confirmedPaymentFollowUps.current = { date: currentDate, rows: remote };
        }
      }
    }
    setPaymentFollowUps(mergePaymentFollowUps(
      currentUser.user_id,
      currentDate,
      remote,
      localVisits.map((visit) => ({ ...visit, lead: leadsById.get(visit.lead_id) ?? null })),
    ));
  }, [currentUser]);

  useEffect(() => {
    void refreshPaymentFollowUps();
    const localSubscription = liveQuery(() => db.field_visits.where("user_id").equals(currentUser?.user_id ?? "").toArray())
      .subscribe({ next: () => void refreshPaymentFollowUps(), error: (error) => console.error("Payment follow-up local refresh failed:", error) });
    const refreshWhenAvailable = () => void refreshPaymentFollowUps();
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") void refreshPaymentFollowUps(); };
    window.addEventListener("online", refreshWhenAvailable);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    const todayBounds = getISTBusinessDayBounds(getCurrentISTDate());
    const rolloverTimer = window.setTimeout(refreshWhenAvailable, Math.max(1_000, new Date(todayBounds.endsAt).getTime() - Date.now() + 250));
    return () => {
      localSubscription.unsubscribe();
      window.removeEventListener("online", refreshWhenAvailable);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.clearTimeout(rolloverTimer);
    };
  }, [currentUser?.user_id, refreshPaymentFollowUps]);

  // Scoped KPIs
  const [queriesResolvedToday, setQueriesResolvedToday] = useState(0);
  const [openQueries, setOpenQueries] = useState(0);
  const [mappedToday, setMappedToday] = useState(0);

  const refreshAllocatedTargets = useCallback(async () => {
    if (!currentUser || !isSupabaseConfigured || !navigator.onLine) return;
    const { data, error } = await supabase.from("allocated_targets").select("target_id,batch_id,assigned_to_user_id,target_username,target_name,target_address,target_area,target_state,target_mobile,target_email,city,pspa_code,third_party_code,dlic1,dlic2,dlic3,dlic4,food_license,is_completed,completed_at,created_at").eq("assigned_to_user_id", currentUser.user_id).eq("is_completed", false).order("created_at", { ascending: true });
    if (error) { setTargetLoadError("Unable to refresh field targets. Please try again."); console.error("Allocated target refresh failed", error); return; }
    if (!data) return;
    await db.allocated_targets.bulkPut(data as LocalAllocatedTarget[]);
  }, [currentUser]);

  useEffect(() => {
    if (!currentUser) return;
    const subscription = liveQuery(async () => (await db.allocated_targets.where("assigned_to_user_id").equals(currentUser.user_id).toArray()).filter((target) => !Boolean(target.is_completed)).sort((a, b) => a.created_at.localeCompare(b.created_at))).subscribe({ next: setAllocatedTargets, error: (error) => console.error("Allocated target live query failed", error) });
    return () => subscription.unsubscribe();
  }, [currentUser]);

  useEffect(() => { refreshAllocatedTargets(); }, [refreshAllocatedTargets]);
  useEffect(() => {
    const onVisibility = () => { if (document.visibilityState === "visible") refreshAllocatedTargets(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [refreshAllocatedTargets]);

  const loadTasksAndKpis = useCallback(async () => {
    if (!currentUser) return;
    
    // 1. Load tasks
    const t = await getOrGenerateTodayTasks(currentUser.user_id, capabilities, { includeLater: true });
    setTasks(t);

    // 2. Load KPIs based on roles
    const todayStr = getCurrentISTDate();
    
    try {
      const allMappings = await db.mapping_requests.toArray();
      setMappedToday(allMappings.filter(m => m.mapped_by === currentUser.user_id && m.status === 'Completed' && m.completed_at && getISTDateKey(m.completed_at) === todayStr).length);

      
      if (hasSupport) {
        const allQueries = await db.client_queries.where("assigned_to").equals(currentUser.user_id).toArray();
        setQueriesResolvedToday(allQueries.filter(q => q.problem_status === "Resolved" && q.resolved_at && getISTDateKey(q.resolved_at) === todayStr).length);
        setOpenQueries(allQueries.filter(q => q.problem_status !== "Resolved").length);
      }

      const allTargets = await db.allocated_targets.where("assigned_to_user_id").equals(currentUser.user_id).toArray();
      setAllocatedTargets(allTargets.filter(t => !t.is_completed));
    } catch (err) {
      console.error("Failed to load KPIs", err);
    }
    
    setLoading(false);
  }, [currentUser, capabilities, hasSupport]);

  useEffect(() => {
    loadTasksAndKpis();
  }, [loadTasksAndKpis]);

  const executeTaskCompletion = async (task: LocalTask, outcome?: string) => {
    if (!currentUser || markingId) return;
    setTaskActionMessage(null);
    setMarkingId(task.task_id);

    try {
      const isSelfScheduledFollowUp = isValidSelfScheduledFollowUp(task, currentUser.user_id);
      let followUpCallConfirmed = !isSelfScheduledFollowUp;
      if (isSelfScheduledFollowUp) {
        const verifiedOutcome = outcome?.trim();
        if (!verifiedOutcome) {
          setTaskActionMessage({ type: "error", text: "A call outcome is required before this follow-up can be completed." });
          return;
        }

        // The task UUID is also the semantic completion-operation UUID. Reusing it
        // across tables makes a stale retry conflict instead of creating a second call.
        const logId = task.task_id;
        const historyId = task.task_id;
        const completedAt = new Date().toISOString();
        const sourceCallId = parseFollowUpSourceCallId(task.description);
        let sourceCall = sourceCallId ? await db.call_logs.get(sourceCallId) : null;
        if (!sourceCall && sourceCallId && navigator.onLine && isSupabaseConfigured) {
          const remoteSource = await supabase.from("call_logs").select("*").eq("log_id", sourceCallId).eq("user_id", currentUser.user_id).maybeSingle();
          if (!remoteSource.error && remoteSource.data) {
            sourceCall = remoteSource.data;
            await db.call_logs.put(remoteSource.data);
          }
        }
        const newLog = {
          log_id: logId,
          user_id: currentUser.user_id,
          lead_id: sourceCall?.lead_id ?? task.related_lead_id ?? null,
          client_username: sourceCall?.client_username ?? null,
          client_name: sourceCall?.client_name ?? null,
          timestamp: completedAt,
          outcome: verifiedOutcome,
          notes: `Task completed: ${task.title}`,
        };
        const taskUpdate = { task_id: task.task_id, status: "Completed" as const, completed_at: completedAt };
        await db.transaction("rw", [db.call_logs, db.tasks, db.task_status_history, db.sync_queue], async () => {
          const currentTask = await db.tasks.get(task.task_id);
          if (
            !currentTask ||
            currentTask.status === "Completed" ||
            !isValidSelfScheduledFollowUp(currentTask, currentUser.user_id)
          ) {
            throw new Error("Follow-up task is no longer available for completion.");
          }
          const historyEntry = {
            id: historyId,
            task_id: task.task_id,
            changed_by: currentUser.user_id,
            old_status: currentTask.status,
            new_status: "Completed",
            changed_at: completedAt,
          };
          const updated = await db.tasks.update(task.task_id, taskUpdate);
          if (updated !== 1) throw new Error("Follow-up task is no longer available.");
          await db.task_status_history.add(historyEntry);
          await db.call_logs.add(newLog);
          await db.sync_queue.add({
            table_name: "tasks",
            action: "UPDATE",
            owner_user_id: claimSyncQueueOwnership(),
            data: taskUpdate,
            timestamp: completedAt,
            idempotency_key: `followup-completion-task:${task.task_id}`,
            retry_count: 0,
          });
          await db.sync_queue.add({
            table_name: "task_status_history",
            action: "INSERT",
            owner_user_id: claimSyncQueueOwnership(),
            data: historyEntry,
            timestamp: completedAt,
            idempotency_key: `followup-completion-history:${task.task_id}`,
            retry_count: 0,
          });
          await db.sync_queue.add({
            table_name: "call_logs",
            action: "INSERT",
            owner_user_id: claimSyncQueueOwnership(),
            data: newLog,
            timestamp: completedAt,
            idempotency_key: `followup-completion-call:${task.task_id}`,
            retry_count: 0,
          });
        });
        if (navigator.onLine) {
          await processSyncQueue();
          followUpCallConfirmed = !(await db.sync_queue.where("idempotency_key").equals(`followup-completion-call:${task.task_id}`).first());
        }
      } else {
        await updateTaskStatus(task, "Completed", currentUser.user_id);
      }

      setTasks((previous) =>
        sortTasks(
          previous.map((currentTask) =>
            currentTask.task_id === task.task_id
              ? { ...currentTask, status: "Completed" as const, completed_at: new Date().toISOString() }
              : currentTask
          )
        )
      );
      await refreshDailySummary();
      setTaskActionMessage(followUpCallConfirmed
        ? { type: "success", text: `“${task.title}” was marked complete.` }
        : { type: "error", text: "The follow-up is saved safely and will confirm automatically when the connection is available." });
      setCompletionDialogTask(null);
      setCompletionOutcome("Follow-up completed");
    } catch (error) {
      console.error("Task completion failed", error);
      setTaskActionMessage({ type: "error", text: "The task could not be completed. Your existing data remains unchanged; please try again." });
    } finally {
      setMarkingId(null);
    }
  };

  const handleComplete = (task: LocalTask) => {
    if (currentUser && isValidSelfScheduledFollowUp(task, currentUser.user_id)) {
      setCompletionOutcome("Follow-up completed");
      setCompletionDialogTask(task);
      return;
    }
    void executeTaskCompletion(task);
  };

  const handleDelete = (task: LocalTask) => {
    if (!currentUser || markingId) return;
    if (!isAdmin && currentUser.user_id !== task.assigned_by) {
      setTaskActionMessage({ type: "error", text: "Only the assigning user or an administrator can delete this task." });
      return;
    }
    setTaskActionMessage(null);
    setDeleteDialogTask(task);
  };

  const confirmTaskDelete = async () => {
    if (!deleteDialogTask || !currentUser || markingId) return;
    const task = deleteDialogTask;
    setMarkingId(task.task_id);
    try {
      await transactionalMutation("tasks", "DELETE", { task_id: task.task_id });
      setTasks((previous) => previous.filter((currentTask) => currentTask.task_id !== task.task_id));
      setDeleteDialogTask(null);
      setTaskActionMessage({ type: "success", text: `“${task.title}” was deleted.` });
    } catch (error) {
      console.error("Task deletion failed", error);
      setTaskActionMessage({ type: "error", text: "The task could not be deleted. Please retry after checking your connection." });
    } finally {
      setMarkingId(null);
    }
  };

  const handleSyncData = async () => {
    setIsSyncing(true);
    try {
      await refreshAllocatedTargets();
      await loadTasksAndKpis();
      await refreshDailySummary();
    } finally {
      setIsSyncing(false);
    }
  };

  const handleCompleteTarget = async (targetId: string) => {
    if (!currentUser || markingId) return;
    const completedAt = new Date().toISOString();
    setMarkingId(targetId);
    setTargetErrors((current) => { const next = { ...current }; delete next[targetId]; return next; });
    try {
      if (!navigator.onLine || !isSupabaseConfigured) {
        await db.transaction("rw", db.allocated_targets, db.sync_queue, async () => {
          await db.allocated_targets.update(targetId, { is_completed: true, completed_at: completedAt, sync_status: "pending" });
          await db.sync_queue.add({ idempotency_key: `complete-target-${targetId}`, owner_user_id: claimSyncQueueOwnership(), table_name: "allocated_targets", action: "UPDATE", data: { target_id: targetId, is_completed: true, completed_at: completedAt }, timestamp: completedAt, retry_count: 0 });
        });
        setAllocatedTargets((current) => current.filter((target) => target.target_id !== targetId)); setTargetNotice("Saved offline. Completion is pending synchronization."); return;
      }
      const { data, error } = await supabase.from("allocated_targets").update({ is_completed: true, completed_at: completedAt }).eq("target_id", targetId).eq("assigned_to_user_id", currentUser.user_id).eq("is_completed", false).select("target_id").maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("This target was already completed or is no longer assigned to you.");
      await db.allocated_targets.update(targetId, { is_completed: true, completed_at: completedAt, sync_status: "synced", last_synced_at: completedAt });
      setAllocatedTargets((current) => current.filter((target) => target.target_id !== targetId));
    } catch (error) { setTargetErrors((current) => ({ ...current, [targetId]: error instanceof Error ? error.message : "Unable to complete this target." })); }
    finally { setMarkingId(null); }
  };

  const todayKey = getCurrentISTDate();
  const upcomingTasks = sortTasks(tasks.filter(task => task.assigned_to === currentUser?.user_id && task.is_active !== false && task.status !== "Completed" && task.status !== "Missed" && task.due_date > todayKey))
    .sort((a, b) => a.due_date.localeCompare(b.due_date)).slice(0, 5);
  const selectedTask = tasks.find((task) => task.task_id === selectedTaskId);
  return (
    <div className="app-page crm-workspace">
      <header className="workspace-heading"><div><h1>My Day</h1><p>{todayKey} · Asia/Kolkata · Your assigned work</p></div><Button variant="outline" onClick={handleSyncData} disabled={isSyncing} icon={<RefreshCw size={15} />}>{isSyncing ? "Syncing" : "Sync data"}</Button></header>
      {taskActionMessage && <div className={`alert-panel ${taskActionMessage.type === "success" ? "alert-panel--success" : "alert-panel--danger"}`} role={taskActionMessage.type === "success" ? "status" : "alert"}>{taskActionMessage.text}</div>}
      <Tabs value={workspaceView} onValueChange={setWorkspaceView} activationMode="manual"><TabsList aria-label="My Day view"><TabsTrigger value="agenda">Agenda</TabsTrigger><TabsTrigger value="history">My history</TabsTrigger></TabsList>
      <TabsContent value="history">{workspaceView === "history" && currentUser && <OwnHistory key={currentUser.user_id} self />}</TabsContent>
      <TabsContent value="agenda" className="space-y-4">
      <div className="workspace-columns">
        <div className="min-w-0">
          {loading ? <SkeletonCard /> : <WorkAgenda tasks={tasks} today={todayKey} view={agendaView} onView={setAgendaView} selectedId={selectedTaskId} onSelect={(task, trigger) => { taskTrigger.current = trigger; setSelectedTaskId(task.task_id); }} onComplete={handleComplete} onDelete={handleDelete} canDelete={(task) => isAdmin || currentUser?.user_id === task.assigned_by} markingId={markingId} />}
          <p className="mt-3 text-xs text-[var(--text-secondary)]">{tasks.length} active local task records · Exact due dates, not appointment times. Completed records shown are from the loaded task set.</p>
        </div>
        {selectedTask ? <ContextRail open title={selectedTask.title} description={`Due ${selectedTask.due_date} · ${selectedTask.status}`} onClose={() => setSelectedTaskId(null)} returnFocus={taskTrigger}>
          <p>{stripInternalFollowUpMarkers(selectedTask.description) || "No additional task description."}</p>
          <dl className="space-y-2"><div><dt>Priority</dt><dd>{selectedTask.priority}</dd></div><div><dt>Task source</dt><dd>{selectedTask.source}</dd></div></dl>
          {selectedTask.related_lead_id && <p>This assigned task retains its exact linked lead. Pipeline-derived lead signals are not included in My Day.</p>}
          {currentUser && isValidSelfScheduledFollowUp(selectedTask, currentUser.user_id) && <p>Completing this follow-up requires a call outcome. Saved offline work remains pending until confirmed.</p>}
        </ContextRail> : <aside className="workspace-upcoming"><h2>Coming up</h2><p className="mt-1 text-xs text-[var(--text-secondary)]">Active future-due tasks · No invented appointment times</p><ol className="mt-3 space-y-3">{upcomingTasks.map((task) => <li key={task.task_id}><button className="min-h-11 text-left text-sm font-semibold" onClick={(event) => { taskTrigger.current = event.currentTarget; setSelectedTaskId(task.task_id); }}>{task.title}</button><p className="text-xs text-[var(--text-secondary)]">{task.due_date}</p></li>)}</ol><Button variant="ghost" size="sm" onClick={() => setAgendaView("Later")}>View later tasks</Button></aside>}
      </div>
      {/* Allocated Field Targets */}
      {(allocatedTargets.length > 0 || targetLoadError || targetNotice) && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-widest flex items-center gap-1.5">
            <MapPin size={14} className="text-[var(--brand-500)]" /> Field Targets ({allocatedTargets.length})
          </h2>
          <div className="space-y-2">
            {targetNotice && <p className="rounded-[var(--radius-md)] bg-[var(--status-warning-soft)] p-3 text-xs font-semibold text-[var(--status-warning)]">{targetNotice}</p>}
            {targetLoadError && <div className="rounded-[var(--radius-md)] bg-[var(--status-danger-soft)] p-3 text-xs text-[var(--status-danger)]">{targetLoadError}<button onClick={() => refreshAllocatedTargets()} className="ml-2 font-semibold underline">Retry</button></div>}
            {allocatedTargets.map((target) => (
              <Card key={target.target_id} className="flex items-start justify-between gap-3 p-4 border-l-4 border-l-[var(--brand-500)]">
                <div className="flex-1 min-w-0">
                  {/* Identity Standard: {Name} (@{Username}) - {Phone} */}
                  <p className="font-semibold text-sm text-[var(--text-primary)] leading-snug">
                    {target.target_name} (@{target.target_username}) - {target.target_mobile}
                  </p>
                  {target.target_address && (
                    <p className="text-xs text-[var(--text-muted)] mt-1 line-clamp-1">
                      {target.target_address} {target.target_area ? `, ${target.target_area}` : ''}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    <Chip variant="brand" size="sm">
                      {target.city}
                    </Chip>
                    {target.food_license && (
                      <Chip variant="warning" size="sm">
                        FSSAI: {target.food_license}
                      </Chip>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  {/* Mandatory Single Action Button: "Done" */}
                  <Button
                    size="sm"
                    onClick={() => handleCompleteTarget(target.target_id)}
                    isLoading={markingId === target.target_id}
                  >
                    Done ✓
                  </Button>
                  {targetErrors[target.target_id] && (
                    <div className="text-[10px] text-[var(--status-danger)]">
                      <span>{targetErrors[target.target_id]}</span>
                      <button onClick={() => handleCompleteTarget(target.target_id)} className="ml-1 underline">Retry</button>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}


      {paymentFollowUps.length > 0 && (
        <section className="mb-4 rounded-[var(--radius-lg)] border border-[var(--status-warning)] bg-[var(--status-warning-soft)] p-4 shadow-[var(--shadow-raised)]" aria-labelledby="payment-followups-title">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--surface-primary)] text-[var(--status-warning)]"><AlertCircle size={17} /></span>
            <div className="min-w-0 flex-1">
              <h2 id="payment-followups-title" className="text-[14px] font-semibold text-[var(--text-primary)]">Payment follow-ups due today</h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {paymentFollowUps.map((item) => (
                  <article key={item.visit_id} className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface-primary)] p-3 text-[12px] text-[var(--text-secondary)]">
                    <p><span className="font-semibold text-[var(--text-primary)]">Username:</span> {item.username}</p>
                    <p className="mt-1"><span className="font-semibold text-[var(--text-primary)]">Party:</span> {item.party_name}</p>
                    <div className="mt-2 flex flex-wrap gap-2"><Chip variant="warning" size="sm">Due today</Chip><Chip variant="neutral" size="sm">Payment follow-up</Chip></div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}


      <PaymentCollectionsPriorityPanel />
      {dailySummaryError && <div role="alert" className="alert-panel alert-panel--danger">{dailySummaryError}</div>}
      <details className="workspace-disclosure"><summary>Daily work summary · distinct recorded work types</summary>
        <dl className="workspace-counts">
          <div><dt>Tasks done · confirmed, includes targets</dt><dd>{dailySummary?.total_tasks_completed_today ?? "Unavailable"}</dd></div>
          <div><dt>Mappings done · local</dt><dd>{mappedToday}</dd></div>
          {hasOnboarding && <><div><dt>Calls today · local and confirmed IDs</dt><dd>{dailySummary?.genuine_calls_today ?? localCallsToday}</dd></div><div><dt>Follow-up calls · subset of Calls</dt><dd>{dailySummary?.followup_calls_today ?? localFollowupCallsToday}</dd></div></>}
          <div><dt>Unique completed work · confirmed</dt><dd>{dailySummary?.unique_completed_work ?? "Unavailable"}</dd></div>
          {hasSupport && <><div><dt>Queries resolved today · local</dt><dd>{queriesResolvedToday}</dd></div><div><dt>Open queries · local</dt><dd>{openQueries}</dd></div></>}
        </dl><p className="text-xs">Linked follow-up call/task pairs count once in unique completed work. These counts are not a productivity score.</p>
      </details>
      </TabsContent></Tabs>
      <Modal
        open={Boolean(completionDialogTask)}
        onClose={() => !markingId && setCompletionDialogTask(null)}
        title="Complete follow-up"
        description={completionDialogTask ? `Record the call outcome for “${completionDialogTask.title}” before closing the task.` : undefined}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setCompletionDialogTask(null)} disabled={Boolean(markingId)}>Cancel</Button>
            <Button
              onClick={() => completionDialogTask && executeTaskCompletion(completionDialogTask, completionOutcome)}
              disabled={!completionOutcome.trim()}
              isLoading={Boolean(completionDialogTask && markingId === completionDialogTask.task_id)}
            >
              Save outcome and complete
            </Button>
          </>
        }
      >
        <Input
          data-autofocus
          label="Call outcome"
          value={completionOutcome}
          onChange={(event) => setCompletionOutcome(event.target.value)}
          placeholder="Describe what happened on the follow-up"
          required
        />
      </Modal>

      <Modal
        open={Boolean(deleteDialogTask)}
        onClose={() => !markingId && setDeleteDialogTask(null)}
        title="Delete task?"
        description="This removes the task from the current queue and sends the deletion through the existing sync workflow."
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleteDialogTask(null)} disabled={Boolean(markingId)}>Keep task</Button>
            <Button variant="danger" onClick={confirmTaskDelete} isLoading={Boolean(deleteDialogTask && markingId === deleteDialogTask.task_id)}>
              Delete task
            </Button>
          </>
        }
      >
        <div className="alert-panel alert-panel--warning">
          <AlertCircle size={17} className="mt-0.5 shrink-0" />
          <span>{deleteDialogTask ? `“${deleteDialogTask.title}” will no longer appear in the assignee’s daily work.` : "This action cannot be reversed from this screen."}</span>
        </div>
      </Modal>
    </div>
  );
}
