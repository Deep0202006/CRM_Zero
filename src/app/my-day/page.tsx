"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { liveQuery } from "dexie";
import { useAuth } from "@/context/AuthContext";
import {
  getOrGenerateTodayTasks,
  updateTaskStatus,
  sortTasks,
  getMyDayStats,
  type LocalTask,
} from "@/lib/taskEngine";
import { CONVERTED_STAGES } from "@/lib/pipelineStages";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import { claimSyncQueueOwnership, db, processSyncQueue, transactionalMutation, type LocalAllocatedTarget, type LocalUser } from "@/lib/db";
import { CheckCircle2, Clock, AlertCircle, ListTodo, PhoneCall, Trophy, CheckSquare, Target, Download, Trash2, MapPin, RefreshCw, Bell } from "lucide-react";
import { exportPipelineToExcel } from "@/lib/pipelineExport";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader } from "@/components/ui/PageHeader";
import { MetricCard } from "@/components/ui/MetricCard";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { isValidSelfScheduledFollowUp, parseFollowUpSourceCallId, stripInternalFollowUpMarkers } from "@/lib/followUps";
import { getCurrentISTDate, getISTBusinessDayBounds, getISTDateKey } from "@/lib/dateTime";
import { mergePaymentFollowUps, type PaymentFollowUpIdentity } from "@/lib/fieldVisits/paymentFollowUps";
import { getCanonicalDailyUserMetrics } from "@/lib/workMetrics/canonical";
import PaymentCollectionsPriorityPanel from "@/components/PaymentCollectionsPriorityPanel";

interface WeeklyDigestTaskPerformance { assigned_to: string; completed_count: number; total_count: number; }
interface WeeklyDigest { week_start: string; data: { stuck_leads: { id: string; name: string; status: string; days_in_stage: number; assigned_to: string }[]; task_performance: WeeklyDigestTaskPerformance[]; upcoming_renewals: { id: string; name: string; renewal_date: string }[]; }; }
interface DailySummary { genuine_calls_today: number; followup_calls_today: number; confirmed_genuine_call_ids: string[]; confirmed_followup_call_ids: string[]; normal_tasks_completed_today: number; followup_tasks_completed_today: number; total_tasks_completed_today: number; pending_followups: number; unique_completed_work: number; generated_at: string; }
interface RenewalReminder { distributor_id: string; distributor_name: string; renewal_date: string; renewal_state: string; }

export default function MyDayPage() {
  const { currentUser, capabilities, hasOnboarding, hasSupport, isFieldStaff, isAdmin } = useAuth();
  
  const [tasks, setTasks] = useState<LocalTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [stats, setStats] = useState({ pendingToday: 0, scheduledLater: 0 });
  const [weeklyDigest, setWeeklyDigest] = useState<WeeklyDigest | null>(null);
  const [weeklyDigestUnavailable, setWeeklyDigestUnavailable] = useState(false);
  const [allocatedTargets, setAllocatedTargets] = useState<LocalAllocatedTarget[]>([]);
  const [targetErrors, setTargetErrors] = useState<Record<string, string>>({});
  const [targetNotice, setTargetNotice] = useState<string | null>(null);
  const [targetLoadError, setTargetLoadError] = useState<string | null>(null);
  const [taskActionMessage, setTaskActionMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [completionDialogTask, setCompletionDialogTask] = useState<LocalTask | null>(null);
  const [completionOutcome, setCompletionOutcome] = useState("Follow-up completed");
  const [deleteDialogTask, setDeleteDialogTask] = useState<LocalTask | null>(null);
  const [dailySummary, setDailySummary] = useState<DailySummary | null>(null);
  const [localCallsToday, setLocalCallsToday] = useState(0);
  const [localFollowupCallsToday, setLocalFollowupCallsToday] = useState(0);
  const [paymentFollowUps, setPaymentFollowUps] = useState<PaymentFollowUpIdentity[]>([]);
  const confirmedPaymentFollowUps = useRef<{ date: string; rows: PaymentFollowUpIdentity[] }>({ date: "", rows: [] });
  const [renewalReminders, setRenewalReminders] = useState<{ total: number; rows: RenewalReminder[] }>({ total: 0, rows: [] });
  
  const refreshRenewals = useCallback(async () => {
    if (!currentUser || !navigator.onLine || !isSupabaseConfigured) return;
    const { data } = await supabase.auth.getSession();
    if (!data.session?.access_token) return;
    try {
      const response = await fetch("/api/distributors/renewals", { headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: "no-store" });
      if (response.ok) {
        const result = await response.json();
        if (result.enabled) setRenewalReminders({ total: result.total || 0, rows: result.rows || [] });
      }
    } catch (e) {
      console.error("Renewal refresh failed:", e);
    }
  }, [currentUser]);

  useEffect(() => { void refreshRenewals(); }, [refreshRenewals]);

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
    const response = await fetch("/api/my-day/daily-summary", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!response.ok) throw new Error("Confirmed My Day summary is unavailable.");
    const summary = await response.json() as DailySummary;
    summary.genuine_calls_today = new Set([...(summary.confirmed_genuine_call_ids ?? []), ...localMetric.genuine_call_ids]).size;
    summary.followup_calls_today = new Set([...(summary.confirmed_followup_call_ids ?? []), ...localMetric.followup_call_ids]).size;
    setDailySummary(summary);
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
  const [leadsConverted, setLeadsConverted] = useState(0);
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
    const t = await getOrGenerateTodayTasks(currentUser.user_id, capabilities);
    setTasks(t);

    // 2. Load KPIs based on roles
    const todayStr = getCurrentISTDate();
    
    try {
      const allMappings = await db.mapping_requests.toArray();
      setMappedToday(allMappings.filter(m => m.mapped_by === currentUser.user_id && m.status === 'Completed' && m.completed_at && getISTDateKey(m.completed_at) === todayStr).length);

      if (hasOnboarding) {
        const allLeads = await db.leads.where("assigned_to").equals(currentUser.user_id).toArray();
        setLeadsConverted(allLeads.filter(l => CONVERTED_STAGES.includes(l.status as typeof CONVERTED_STAGES[number])).length);
      }
      
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
  }, [currentUser, capabilities, hasOnboarding, hasSupport]);

  useEffect(() => {
    loadTasksAndKpis();
  }, [loadTasksAndKpis]);

  useEffect(() => {
    if (!currentUser) return;
    getMyDayStats(currentUser.user_id).then(setStats);
  }, [currentUser, tasks]);

  useEffect(() => {
    if (!currentUser) return;
    if (isAdmin) {
      if (isSupabaseConfigured) {
        setWeeklyDigestUnavailable(false);
        supabase
          .from('weekly_digest_log')
          .select('*')
          .order('week_start', { ascending: false })
          .limit(1)
          .then(({ data, error }: { data: WeeklyDigest[] | null; error: unknown }) => {
            if (error) {
              setWeeklyDigest(null);
              setWeeklyDigestUnavailable(true);
            } else if (data && data.length > 0) {
              setWeeklyDigest(data[0]);
            } else {
              setWeeklyDigest(null);
            }
          });
      } else {
        setWeeklyDigest(null);
        setWeeklyDigestUnavailable(true);
      }
    }
  }, [currentUser, isAdmin]);

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
      await getMyDayStats(currentUser.user_id).then(setStats);
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
      await getMyDayStats(currentUser.user_id).then(setStats);
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

  const pending = tasks.filter((t) => t.status === "Pending");
  const inProgress = tasks.filter((t) => t.status === "In Progress");
  const done = tasks.filter((t) => t.status === "Completed");
  const missed = tasks.filter((t) => t.status === "Missed");
  const progressPct = tasks.length === 0 ? 0 : Math.round((done.length / tasks.length) * 100);

  const followUpsToday = currentUser
    ? pending.filter((task) => isValidSelfScheduledFollowUp(task, currentUser.user_id))
    : [];

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Daily execution"
        icon={<ListTodo size={16} />}
        title="My Day"
        description={`${today} · Prioritise the work that moves clients, targets, and service outcomes forward.`}
        actions={
          <>
            <Button
              variant="outline"
              onClick={handleSyncData}
              disabled={isSyncing}
              icon={<RefreshCw size={15} className={isSyncing ? "animate-spin" : ""} />}
            >
              {isSyncing ? "Syncing" : "Sync data"}
            </Button>
            {hasOnboarding && (
              <Button
                onClick={() => {
                  if (currentUser) exportPipelineToExcel(currentUser.user_id, false);
                }}
                icon={<Download size={15} />}
              >
                Export pipeline
              </Button>
            )}
          </>
        }
        meta={
          <>
            <Chip variant={progressPct === 100 ? "success" : "brand"} size="sm" dot>{progressPct}% complete</Chip>
            <Chip variant="neutral" size="sm">{done.length} of {tasks.length} tasks done</Chip>
          </>
        }
      />

      <PaymentCollectionsPriorityPanel />

      {renewalReminders.total > 0 && (
        <section className="mb-4 rounded-[var(--radius-lg)] border border-blue-300 bg-blue-50 p-4 shadow-[var(--shadow-raised)]" aria-labelledby="renewals-title">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-white text-blue-700"><Bell size={17} /></span>
            <div className="min-w-0 flex-1">
              <h2 id="renewals-title" className="text-[14px] font-semibold text-blue-950">
                Actionable Renewals ({renewalReminders.total})
              </h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {renewalReminders.rows.map((row) => (
                  <article key={row.distributor_id} className="rounded-[var(--radius-md)] border border-blue-200 bg-white p-3 text-[12px] text-[var(--text-secondary)]">
                    <p className="font-semibold text-[var(--text-primary)]">{row.distributor_name}</p>
                    <p className="mt-1">Date: {row.renewal_date}</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Chip variant={row.renewal_state === "renewal_overdue" ? "danger" : "warning"} size="sm">
                        {row.renewal_state.replace("renewal_", "").replace("_", " ")}
                      </Chip>
                    </div>
                  </article>
                ))}
              </div>
              <div className="mt-3">
                <Link href="/payments/renewals" className="text-sm font-semibold text-blue-700 hover:underline">
                  View all renewals &rarr;
                </Link>
              </div>
            </div>
          </div>
        </section>
      )}

      {paymentFollowUps.length > 0 && (
        <section className="mb-4 rounded-[var(--radius-lg)] border border-amber-300 bg-amber-50 p-4 shadow-[var(--shadow-raised)]" aria-labelledby="payment-followups-title">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-white text-amber-700"><AlertCircle size={17} /></span>
            <div className="min-w-0 flex-1">
              <h2 id="payment-followups-title" className="text-[14px] font-semibold text-amber-950">Payment follow-ups due today</h2>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {paymentFollowUps.map((item) => (
                  <article key={item.visit_id} className="rounded-[var(--radius-md)] border border-amber-200 bg-white p-3 text-[12px] text-[var(--text-secondary)]">
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

      {taskActionMessage && (
        <div className={`alert-panel ${taskActionMessage.type === "success" ? "alert-panel--success" : "alert-panel--danger"}`} role={taskActionMessage.type === "success" ? "status" : "alert"}>
          {taskActionMessage.type === "success" ? <CheckCircle2 size={17} className="mt-0.5 shrink-0" /> : <AlertCircle size={17} className="mt-0.5 shrink-0" />}
          <span>{taskActionMessage.text}</span>
        </div>
      )}

      {weeklyDigest && (
        <section className="relative overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-inverse)] bg-[var(--surface-sidebar)] p-5 text-white shadow-[var(--shadow-popover)]">
          <div className="absolute -right-20 -top-24 h-56 w-56 rounded-full bg-[var(--brand-400)]/15 blur-[70px]" />
          <div className="relative">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--brand-300)]">Weekly intelligence</p>
                <h2 className="mt-1 text-[18px] font-semibold tracking-[-0.025em] text-white">Week of {weeklyDigest.week_start}</h2>
              </div>
              <p className="text-[11px] text-[var(--text-inverse-muted)]">Signals that may need manager follow-up</p>
            </div>
            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <div className="rounded-[var(--radius-lg)] border border-white/[0.07] bg-white/[0.04] p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-inverse-muted)]">Stuck leads · over 14 days</p>
                <p className="mt-3 text-[28px] font-semibold tracking-[-0.04em] text-white">{weeklyDigest.data.stuck_leads?.length || 0}</p>
              </div>
              <div className="rounded-[var(--radius-lg)] border border-white/[0.07] bg-white/[0.04] p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-inverse-muted)]">Upcoming renewals</p>
                <p className="mt-3 text-[28px] font-semibold tracking-[-0.04em] text-white">{weeklyDigest.data.upcoming_renewals?.length || 0}</p>
              </div>
              <div className="rounded-[var(--radius-lg)] border border-white/[0.07] bg-white/[0.04] p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-inverse-muted)]">Team task average</p>
                <p className="mt-3 text-[28px] font-semibold tracking-[-0.04em] text-[var(--brand-300)]">
                  {weeklyDigest.data.task_performance?.length > 0
                    ? `${Math.round(weeklyDigest.data.task_performance.reduce((acc: number, perf: WeeklyDigestTaskPerformance) => acc + perf.completed_count / perf.total_count, 0) / weeklyDigest.data.task_performance.length * 100)}%`
                    : "N/A"}
                </p>
              </div>
            </div>
          </div>
        </section>
      )}

      {isAdmin && weeklyDigestUnavailable && (
        <EmptyState
          title="Weekly intelligence unavailable"
          description="Confirmed weekly digest data could not be loaded. No fallback data is shown."
        />
      )}

      {!loading && (
        <div className="metric-grid">
          <MetricCard label="Tasks done" value={dailySummary?.total_tasks_completed_today ?? "—"} icon={<CheckSquare size={17} />} note="Server-confirmed completed tasks and targets" tone="success" />
          <MetricCard label="Mapped today" value={mappedToday} icon={<Target size={17} />} note="Distributor-retailer mapping work completed" />
          {hasOnboarding && <MetricCard label="Calls today" value={dailySummary?.genuine_calls_today ?? localCallsToday} icon={<PhoneCall size={17} />} note="Genuine calls recorded today" tone="info" />}
          {hasOnboarding && <MetricCard label="Follow-up calls today" value={dailySummary?.followup_calls_today ?? localFollowupCallsToday} icon={<PhoneCall size={17} />} note="Included in Calls today" tone="info" />}
          <MetricCard label="Unique completed work" value={dailySummary?.unique_completed_work ?? "—"} icon={<CheckCircle2 size={17} />} note="Linked follow-up call and task count once here" tone="success" />
          {hasOnboarding && <MetricCard label="Converted leads" value={leadsConverted} icon={<Trophy size={17} />} note="Leads reaching a converted pipeline stage" tone="warning" />}
          {hasSupport && <MetricCard label="Resolved today" value={queriesResolvedToday} icon={<CheckCircle2 size={17} />} note="Client queries closed today" tone="success" />}
          {hasSupport && <MetricCard label="Open queries" value={openQueries} icon={<AlertCircle size={17} />} note="Service requests still requiring action" tone={openQueries ? "warning" : "success"} />}
          {isFieldStaff && !hasOnboarding && !hasSupport && <MetricCard label="On-time rate" value={`${progressPct}%`} icon={<Target size={17} />} note="Daily execution progress" />}
        </div>
      )}

      {!loading && followUpsToday.length > 0 && (
        <div className="flex items-start gap-3 rounded-[var(--radius-lg)] border border-[var(--status-danger)]/20 bg-[var(--status-danger-soft)] p-4 shadow-[var(--shadow-raised)]">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--surface-primary)] text-[var(--status-danger)]"><AlertCircle size={17} /></span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[13px] font-semibold text-[var(--status-danger)]">Scheduled follow-ups need action</h3>
            <p className="mt-1 text-[11px] leading-5 text-[var(--text-secondary)]">You have {followUpsToday.length} follow-up{followUpsToday.length > 1 ? "s" : ""} scheduled for today.</p>
          </div>
          <Chip variant="danger" size="sm">{followUpsToday.length} due</Chip>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Card variant="muted" className="flex items-center justify-between p-4">
          <div><p className="text-[24px] font-semibold tracking-[-0.04em] text-[var(--status-danger)]">{stats.pendingToday}</p><p className="mt-1 text-[11px] font-medium text-[var(--text-muted)]">Tasks pending today</p></div>
          <AlertCircle size={19} className="text-[var(--status-danger)]" />
        </Card>
        <Card variant="muted" className="flex items-center justify-between p-4">
          <div><p className="text-[24px] font-semibold tracking-[-0.04em] text-[var(--status-info)]">{stats.scheduledLater}</p><p className="mt-1 text-[11px] font-medium text-[var(--text-muted)]">Scheduled for later</p></div>
          <Clock size={19} className="text-[var(--status-info)]" />
        </Card>
      </div>

      {loading && (
        <div className="space-y-3">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {!loading && tasks.length === 0 && allocatedTargets.length === 0 && (
        <EmptyState
          title="No tasks scheduled for today"
          description="Enjoy the quiet or ask your team manager to assign new field targets."
          icon={<CheckCircle2 size={36} className="text-[var(--status-success)]" />}
        />
      )}

      {/* In Progress Tasks */}
      {inProgress.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-widest flex items-center gap-1.5">
            <Clock size={14} className="text-[var(--status-warning)]" /> In Progress
          </h2>
          <div className="space-y-2">
            {inProgress.map((task) => (
              <TaskCardItem
                key={task.task_id}
                task={task}
                markingId={markingId}
                onComplete={handleComplete}
                onDelete={handleDelete}
                currentUser={currentUser}
                isAdmin={isAdmin}
                accent="border-l-[var(--status-warning)]"
              />
            ))}
          </div>
        </section>
      )}

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

      {/* Pending Tasks */}
      {pending.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-widest flex items-center gap-1.5">
            <AlertCircle size={14} className="text-[var(--status-danger)]" /> Pending ({pending.length})
          </h2>
          <div className="space-y-2">
            {pending.map((task) => (
              <TaskCardItem
                key={task.task_id}
                task={task}
                markingId={markingId}
                onComplete={handleComplete}
                onDelete={handleDelete}
                currentUser={currentUser}
                isAdmin={isAdmin}
                accent="border-l-[var(--brand-500)]"
              />
            ))}
          </div>
        </section>
      )}

      {/* Completed Tasks */}
      {done.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-widest flex items-center gap-1.5">
            <CheckCircle2 size={14} className="text-[var(--status-success)]" /> Completed ({done.length})
          </h2>
          <div className="space-y-2">
            {done.map((task) => (
              <Card
                key={task.task_id}
                className="flex items-center justify-between gap-3 p-3 bg-[var(--surface-secondary)] opacity-70"
              >
                <div className="flex items-center gap-3">
                  <CheckCircle2 size={16} className="text-[var(--status-success)] shrink-0" />
                  <span className="text-xs text-[var(--text-secondary)] font-semibold line-through">{task.title}</span>
                </div>
                {task.completed_at && (
                  <span className="text-[10px] text-[var(--text-muted)] font-mono shrink-0">
                    {new Date(task.completed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Missed Tasks */}
      {missed.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold text-[var(--status-danger)] uppercase tracking-widest flex items-center gap-1.5">
            <AlertCircle size={14} /> Missed ({missed.length})
          </h2>
          <div className="space-y-2">
            {missed.map((task) => (
              <Card
                key={task.task_id}
                className="flex items-center justify-between gap-3 p-3 bg-[var(--status-danger-soft)] border-[var(--status-danger)]/20"
              >
                <div className="flex items-center gap-3">
                  <AlertCircle size={16} className="text-[var(--status-danger)] shrink-0" />
                  <span className="text-xs text-[var(--status-danger)] font-semibold">{task.title}</span>
                </div>
                <Chip variant="danger" size="sm">Missed</Chip>
              </Card>
            ))}
          </div>
        </section>
      )}

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

function TaskCardItem({
  task,
  markingId,
  onComplete,
  onDelete,
  currentUser,
  isAdmin,
  accent,
}: {
  task: LocalTask;
  markingId: string | null;
  onComplete: (t: LocalTask) => void;
  onDelete?: (t: LocalTask) => void;
  currentUser: Pick<LocalUser, "user_id"> | null;
  isAdmin: boolean;
  accent: string;
}) {
  const isActing = markingId === task.task_id;
  const canDelete = isAdmin || currentUser?.user_id === task.assigned_by;

  const priorityChipVariant =
    task.priority === "High" ? "danger" : task.priority === "Medium" ? "warning" : "success";

  return (
    <Card className={`flex items-start gap-3 p-4 border-l-4 ${accent}`}>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm text-[var(--text-primary)] leading-snug">{task.title}</p>
        {task.description && (
          <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">{stripInternalFollowUpMarkers(task.description)}</p>
        )}
        <div className="flex items-center gap-2 mt-2">
          <Chip variant={priorityChipVariant} size="sm" dot>
            {task.priority}
          </Chip>
          {task.source === "manual" && (
            <Chip variant="brand" size="sm">
              Manual
            </Chip>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {/* Single Completion Action: "Done" */}
        <Button
          size="sm"
          onClick={() => onComplete(task)}
          isLoading={isActing}
        >
          Done ✓
        </Button>
        {onDelete && canDelete && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDelete(task)}
            disabled={isActing}
            className="text-[var(--status-danger)] hover:bg-[var(--status-danger-soft)] px-2"
            title="Delete Task"
            icon={<Trash2 size={14} />}
          />
        )}
      </div>
    </Card>
  );
}
