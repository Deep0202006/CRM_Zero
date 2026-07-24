"use client";

import { useEffect, useState, useCallback } from "react";
import { liveQuery } from "dexie";
import { useAuth } from "@/context/AuthContext";
import {
  getOrGenerateTodayTasks,
  updateTaskStatus,
  sortTasks,
  getMyDayStats,
  type LocalTask,
} from "@/lib/taskEngine";
import { CONVERTED_STAGES } from "@/lib/pipelineRules";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import { db, transactionalMutation, type LocalAllocatedTarget, type LocalUser } from "@/lib/db";
import { CheckCircle2, Clock, AlertCircle, ListTodo, PhoneCall, Trophy, CheckSquare, Target, Download, Trash2, MapPin, RefreshCw } from "lucide-react";
import { exportPipelineToExcel } from "@/lib/pipelineExport";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";

interface WeeklyDigestTaskPerformance { assigned_to: string; completed_count: number; total_count: number; }
interface WeeklyDigest { week_start: string; data: { stuck_leads: { id: string; name: string; status: string; days_in_stage: number; assigned_to: string }[]; task_performance: WeeklyDigestTaskPerformance[]; upcoming_renewals: { id: string; name: string; renewal_date: string }[]; }; }

export default function MyDayPage() {
  const { currentUser, capabilities, hasOnboarding, hasSupport, isFieldStaff, isAdmin } = useAuth();
  
  const [tasks, setTasks] = useState<LocalTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [stats, setStats] = useState({ pendingToday: 0, scheduledLater: 0 });
  const [weeklyDigest, setWeeklyDigest] = useState<WeeklyDigest | null>(null);
  const [allocatedTargets, setAllocatedTargets] = useState<LocalAllocatedTarget[]>([]);
  const [targetErrors, setTargetErrors] = useState<Record<string, string>>({});
  const [targetNotice, setTargetNotice] = useState<string | null>(null);
  const [targetLoadError, setTargetLoadError] = useState<string | null>(null);

  // Scoped KPIs
  const [callsToday, setCallsToday] = useState(0);
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
    const remoteIds = new Set(data.map((target) => target.target_id));
    const local = await db.allocated_targets.where("assigned_to_user_id").equals(currentUser.user_id).toArray();
    await db.allocated_targets.bulkDelete(local.filter((target) => !Boolean(target.is_completed) && target.sync_status !== "pending" && !remoteIds.has(target.target_id)).map((target) => target.target_id));
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
    const todayStr = new Date().toISOString().slice(0, 10);
    
    try {
      const allMappings = await db.mapping_requests.toArray();
      setMappedToday(allMappings.filter(m => m.mapped_by === currentUser.user_id && m.status === 'Completed' && m.completed_at?.startsWith(todayStr)).length);

      if (hasOnboarding) {
        const allCalls = await db.call_logs.where("user_id").equals(currentUser.user_id).toArray();
        setCallsToday(allCalls.filter(c => c.timestamp.startsWith(todayStr) && !c.outcome.includes("→")).length);
        
        const allLeads = await db.leads.where("assigned_to").equals(currentUser.user_id).toArray();
        setLeadsConverted(allLeads.filter(l => CONVERTED_STAGES.includes(l.status as typeof CONVERTED_STAGES[number])).length);
      }
      
      if (hasSupport) {
        const allQueries = await db.client_queries.where("assigned_to").equals(currentUser.user_id).toArray();
        setQueriesResolvedToday(allQueries.filter(q => q.problem_status === "Resolved" && q.resolved_at?.startsWith(todayStr)).length);
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
        supabase
          .from('weekly_digest_log')
          .select('*')
          .order('week_start', { ascending: false })
          .limit(1)
          .then(({ data }) => {
            if (data && data.length > 0) setWeeklyDigest(data[0]);
          });
      } else {
        setWeeklyDigest({
          week_start: new Date().toISOString().slice(0, 10),
          data: {
            stuck_leads: [{ id: "1", name: "Acme Corp", status: "Interested", days_in_stage: 15, assigned_to: currentUser.user_id }],
            task_performance: [{ assigned_to: currentUser.user_id, completed_count: 14, total_count: 15 }],
            upcoming_renewals: [{ id: "2", name: "Global Tech", renewal_date: "2026-07-20" }]
          }
        });
      }
    }
  }, [currentUser, isAdmin]);

  const handleComplete = async (task: LocalTask) => {
    if (!currentUser || markingId) return;
    
    if (task.source === "manual" && task.related_lead_id) {
      const outcome = window.prompt("Enter call outcome (required for follow-ups):", "Follow-up completed");
      if (!outcome || outcome.trim() === "") return;
      
      setMarkingId(task.task_id);
      const logId = crypto.randomUUID();
      const newLog = {
        log_id: logId,
        user_id: currentUser.user_id,
        lead_id: task.related_lead_id,
        timestamp: new Date().toISOString(),
        outcome: outcome.trim(),
        notes: `Task completed: ${task.title}`
      };
      
      await db.transaction('rw', [db.call_logs, db.sync_queue], async () => {
        await db.call_logs.add(newLog);
        await db.sync_queue.add({
          table_name: "call_logs",
          action: "INSERT",
          data: newLog,
          timestamp: newLog.timestamp,
          idempotency_key: `call-log-${logId}`,
          retry_count: 0
        });
      });
    } else {
      setMarkingId(task.task_id);
    }

    await updateTaskStatus(task, "Completed", currentUser.user_id);
    
    setTasks((prev) =>
      sortTasks(
        prev.map((t) =>
          t.task_id === task.task_id ? { ...t, status: "Completed" as const, completed_at: new Date().toISOString() } : t
        )
      )
    );
    await getMyDayStats(currentUser.user_id).then(setStats);
    setMarkingId(null);
  };

  const handleDelete = async (task: LocalTask) => {
    if (!currentUser || markingId) return;
    if (!isAdmin && currentUser.user_id !== task.assigned_by) {
      alert("You do not have permission to delete this task.");
      return;
    }
    const confirmed = window.confirm("Are you sure you want to delete this task?");
    if (!confirmed) return;
    
    setMarkingId(task.task_id);
    await transactionalMutation("tasks", "DELETE", { task_id: task.task_id });
    setTasks((prev) => prev.filter((t) => t.task_id !== task.task_id));
    setMarkingId(null);
  };

  const handleSyncData = async () => {
    setIsSyncing(true);
    try {
      await refreshAllocatedTargets();
      await loadTasksAndKpis();
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
          await db.sync_queue.add({ idempotency_key: `complete-target-${targetId}`, table_name: "allocated_targets", action: "UPDATE", data: { target_id: targetId, is_completed: true, completed_at: completedAt }, timestamp: completedAt, retry_count: 0 });
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

  const followUpsToday = pending.filter(t => t.source === "manual" && (t.title.includes("Follow-up") || t.title.includes("Re-engage")));

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="space-y-6 w-full max-w-6xl mx-auto">
      {weeklyDigest && (
        <Card variant="elevated" className="bg-slate-900 text-white border-slate-800">
          <h2 className="text-base font-black mb-3">Weekly Digest (Week of {weeklyDigest.week_start})</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-slate-800/80 rounded-[var(--radius-md)] p-3">
              <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Stuck Leads ({">"}14 days)</h3>
              <p className="text-xl font-black">{weeklyDigest.data.stuck_leads?.length || 0}</p>
            </div>
            <div className="bg-slate-800/80 rounded-[var(--radius-md)] p-3">
              <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Upcoming Renewals</h3>
              <p className="text-xl font-black">{weeklyDigest.data.upcoming_renewals?.length || 0}</p>
            </div>
            <div className="bg-slate-800/80 rounded-[var(--radius-md)] p-3">
              <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Team Task Avg</h3>
              {weeklyDigest.data.task_performance?.length > 0 ? (
                <p className="text-xl font-black text-[var(--brand-500)]">
                  {Math.round(weeklyDigest.data.task_performance.reduce((acc: number, p: WeeklyDigestTaskPerformance) => acc + (p.completed_count/p.total_count), 0) / weeklyDigest.data.task_performance.length * 100)}%
                </p>
              ) : (
                <p className="text-xl font-black text-slate-500">N/A</p>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Header & Main Progress */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <ListTodo size={24} className="text-[var(--brand-500)]" />
            <h1 className="text-2xl font-black text-[var(--text-primary)]">My Day</h1>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSyncData}
              disabled={isSyncing}
              icon={<RefreshCw size={14} className={isSyncing ? "animate-spin text-[var(--brand-500)]" : ""} />}
              className="ml-1 px-2"
              title="Sync latest tasks"
            />
          </div>
          <p className="text-xs text-[var(--text-muted)] font-bold tracking-wider uppercase">{today}</p>
          {hasOnboarding && (
            <Button
              size="sm"
              onClick={() => {
                if (currentUser) exportPipelineToExcel(currentUser.user_id, false);
              }}
              icon={<Download size={14} />}
              className="mt-2"
            >
              Export Pipeline
            </Button>
          )}
        </div>
        
        <Card className="flex items-center gap-4 py-3 px-5 border-[var(--border-subtle)]">
          <div className="relative h-12 w-12 shrink-0">
            <svg className="h-12 w-12 -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--surface-secondary)" strokeWidth="3" />
              <circle
                cx="18" cy="18" r="15.9" fill="none" stroke="var(--brand-500)" strokeWidth="3"
                strokeDasharray={`${progressPct} ${100 - progressPct}`} strokeLinecap="round"
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[11px] font-black text-[var(--brand-500)]">
              {progressPct}%
            </span>
          </div>
          <div>
            <p className="text-base font-black text-[var(--text-primary)]">{done.length}/{tasks.length}</p>
            <p className="text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-wider">Tasks completed</p>
          </div>
        </Card>
      </div>

      {/* ─── Role-Scoped KPIs ─────────────────────────────────────────── */}
      {!loading && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="p-4 flex flex-col justify-between">
            <CheckSquare size={18} className="text-[var(--status-success)] mb-2" />
            <div>
              <p className="text-2xl font-black text-[var(--text-primary)]">{done.length}</p>
              <p className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Tasks Done</p>
            </div>
          </Card>

          <Card className="p-4 flex flex-col justify-between">
            <Target size={18} className="text-[var(--brand-500)] mb-2" />
            <div>
              <p className="text-2xl font-black text-[var(--text-primary)]">{mappedToday}</p>
              <p className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Mapped Today</p>
            </div>
          </Card>
          
          {hasOnboarding && (
            <>
              <Card className="p-4 flex flex-col justify-between">
                <PhoneCall size={18} className="text-[var(--brand-500)] mb-2" />
                <div>
                  <p className="text-2xl font-black text-[var(--text-primary)]">{callsToday}</p>
                  <p className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Calls Today</p>
                </div>
              </Card>
              <Card className="p-4 flex flex-col justify-between">
                <Trophy size={18} className="text-[var(--status-warning)] mb-2" />
                <div>
                  <p className="text-2xl font-black text-[var(--text-primary)]">{leadsConverted}</p>
                  <p className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Converted</p>
                </div>
              </Card>
            </>
          )}
          
          {hasSupport && (
            <>
              <Card className="p-4 flex flex-col justify-between">
                <CheckCircle2 size={18} className="text-[var(--status-info)] mb-2" />
                <div>
                  <p className="text-2xl font-black text-[var(--text-primary)]">{queriesResolvedToday}</p>
                  <p className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Resolved Today</p>
                </div>
              </Card>
              <Card className="p-4 flex flex-col justify-between">
                <AlertCircle size={18} className="text-[var(--status-danger)] mb-2" />
                <div>
                  <p className="text-2xl font-black text-[var(--text-primary)]">{openQueries}</p>
                  <p className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider">Open Queries</p>
                </div>
              </Card>
            </>
          )}

          {isFieldStaff && !hasOnboarding && !hasSupport && (
            <Card className="p-4 flex flex-col justify-between">
              <Target size={18} className="text-[var(--brand-500)] mb-2" />
              <div>
                <p className="text-2xl font-black text-[var(--text-primary)]">{progressPct}%</p>
                <p className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider">On-Time Rate</p>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ─── Follow-up Alerts ────────────────────────────────────────── */}
      {!loading && followUpsToday.length > 0 && (
        <div className="bg-[var(--status-danger-soft)] border border-[var(--status-danger)]/20 rounded-[var(--radius-lg)] p-4 flex items-start gap-3 shadow-xs">
          <AlertCircle size={20} className="text-[var(--status-danger)] shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-black text-[var(--status-danger)]">Action Required: Scheduled Follow-ups</h3>
            <p className="text-xs text-[var(--text-secondary)] font-semibold mt-1">
              You have {followUpsToday.length} follow-up{followUpsToday.length > 1 ? "s" : ""} scheduled for today.
            </p>
          </div>
        </div>
      )}

      {/* ─── Task Stats Summary ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="p-3 text-center bg-rose-50/50 border-rose-100">
          <div className="text-xl font-black text-rose-800">{stats.pendingToday}</div>
          <div className="text-[11px] font-bold text-rose-600">Tasks Pending</div>
        </Card>
        <Card className="p-3 text-center bg-blue-50/50 border-blue-100">
          <div className="text-xl font-black text-blue-800">{stats.scheduledLater}</div>
          <div className="text-[11px] font-bold text-blue-600">Scheduled Later</div>
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
          <h2 className="text-xs font-black text-[var(--text-muted)] uppercase tracking-widest flex items-center gap-1.5">
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
          <h2 className="text-xs font-black text-[var(--text-muted)] uppercase tracking-widest flex items-center gap-1.5">
            <MapPin size={14} className="text-[var(--brand-500)]" /> Field Targets ({allocatedTargets.length})
          </h2>
          <div className="space-y-2">
            {targetNotice && <p className="rounded-[var(--radius-md)] bg-[var(--status-warning-soft)] p-3 text-xs font-semibold text-[var(--status-warning)]">{targetNotice}</p>}
            {targetLoadError && <div className="rounded-[var(--radius-md)] bg-[var(--status-danger-soft)] p-3 text-xs text-[var(--status-danger)]">{targetLoadError}<button onClick={() => refreshAllocatedTargets()} className="ml-2 font-semibold underline">Retry</button></div>}
            {allocatedTargets.map((target) => (
              <Card key={target.target_id} className="flex items-start justify-between gap-3 p-4 border-l-4 border-l-[var(--brand-500)]">
                <div className="flex-1 min-w-0">
                  {/* Identity Standard: {Name} (@{Username}) - {Phone} */}
                  <p className="font-black text-sm text-[var(--text-primary)] leading-snug">
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
          <h2 className="text-xs font-black text-[var(--text-muted)] uppercase tracking-widest flex items-center gap-1.5">
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
          <h2 className="text-xs font-black text-[var(--text-muted)] uppercase tracking-widest flex items-center gap-1.5">
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
          <h2 className="text-xs font-black text-[var(--status-danger)] uppercase tracking-widest flex items-center gap-1.5">
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
        <p className="font-black text-sm text-[var(--text-primary)] leading-snug">{task.title}</p>
        {task.description && (
          <p className="text-xs text-[var(--text-muted)] mt-1 leading-relaxed">{task.description}</p>
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