"use client";

import { useEffect, useState, useCallback } from "react";
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
import { db } from "@/lib/db";
import { CheckCircle2, Clock, AlertCircle, ListTodo, PhoneCall, Trophy, CheckSquare, Target, Download, Trash2 } from "lucide-react";
import { exportPipelineToExcel } from "@/lib/pipelineExport";

const PRIORITY_DOT: Record<string, string> = {
  High: "bg-rose-500",
  Medium: "bg-amber-400",
  Low: "bg-emerald-500",
};

const PRIORITY_BADGE: Record<string, string> = {
  High: "bg-rose-50 text-rose-600 border-rose-200",
  Medium: "bg-amber-50 text-amber-700 border-amber-200",
  Low: "bg-emerald-50 text-emerald-600 border-emerald-200",
};

export default function MyDayPage() {
  const { currentUser, capabilities, hasOnboarding, hasSupport, isFieldStaff, isOfficeStaff, isAdmin } = useAuth();
  
  const [tasks, setTasks] = useState<LocalTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [stats, setStats] = useState({ pendingToday: 0, scheduledLater: 0 });
  const [weeklyDigest, setWeeklyDigest] = useState<any>(null);

  // Scoped KPIs
  const [callsToday, setCallsToday] = useState(0);
  const [leadsConverted, setLeadsConverted] = useState(0);
  const [queriesResolvedToday, setQueriesResolvedToday] = useState(0);
  const [openQueries, setOpenQueries] = useState(0);

  const loadTasksAndKpis = useCallback(async () => {
    if (!currentUser) return;
    
    // 1. Load tasks
    const t = await getOrGenerateTodayTasks(currentUser.user_id, capabilities);
    setTasks(t);

    // 2. Load KPIs based on roles
    const todayStr = new Date().toISOString().slice(0, 10);
    
    try {
      if (hasOnboarding) {
        // Calls today (excluding automatic stage movement notes which contain "→")
        const allCalls = await db.call_logs.where("user_id").equals(currentUser.user_id).toArray();
        setCallsToday(allCalls.filter(c => c.timestamp.startsWith(todayStr) && !c.outcome.includes("→")).length);
        
        // Leads converted (moved to Registration or beyond)
        const allLeads = await db.leads.where("assigned_to").equals(currentUser.user_id).toArray();
        setLeadsConverted(allLeads.filter(l => CONVERTED_STAGES.includes(l.status as any)).length);
      }
      
      if (hasSupport) {
        // Support queries
        const allQueries = await db.client_queries.where("assigned_to").equals(currentUser.user_id).toArray();
        setQueriesResolvedToday(allQueries.filter(q => q.problem_status === "Resolved" && q.resolved_at?.startsWith(todayStr)).length);
        setOpenQueries(allQueries.filter(q => q.problem_status !== "Resolved").length);
      }
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
        // Mock digest when running local-only
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
  }, [currentUser]);

  const handleComplete = async (task: LocalTask) => {
    if (!currentUser || markingId) return;
    setMarkingId(task.task_id);
    await updateTaskStatus(task, "Completed", currentUser.user_id);
    setTasks((prev) =>
      sortTasks(
        prev.map((t) =>
          t.task_id === task.task_id ? { ...t, status: "Completed" as const, completed_at: new Date().toISOString() } : t
        )
      )
    );
    setMarkingId(null);
  };

  const handleStart = async (task: LocalTask) => {
    if (!currentUser || markingId) return;
    setMarkingId(task.task_id);
    await updateTaskStatus(task, "In Progress", currentUser.user_id);
    setTasks((prev) =>
      sortTasks(
        prev.map((t) =>
          t.task_id === task.task_id ? { ...t, status: "In Progress" as const, started_at: new Date().toISOString() } : t
        )
      )
    );
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

  const pending = tasks.filter((t) => t.status === "Pending");
  const inProgress = tasks.filter((t) => t.status === "In Progress");
  const done = tasks.filter((t) => t.status === "Completed");
  const missed = tasks.filter((t) => t.status === "Missed");
  const progressPct = tasks.length === 0 ? 0 : Math.round((done.length / tasks.length) * 100);

  const followUpsToday = pending.filter(t => t.source === "manual" && (t.title.includes("Follow-up") || t.title.includes("Re-engage")));

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
      <div className="space-y-6 w-full">
        {weeklyDigest && (
          <div className="bg-slate-900 text-white rounded-2xl p-5 shadow-lg border border-slate-800">
            <h2 className="text-lg font-black mb-3">Weekly Digest (Week of {weeklyDigest.week_start})</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-slate-800 rounded-xl p-3">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Stuck Leads ({">"}14 days)</h3>
                <p className="text-2xl font-black">{weeklyDigest.data.stuck_leads?.length || 0}</p>
              </div>
              <div className="bg-slate-800 rounded-xl p-3">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Upcoming Renewals</h3>
                <p className="text-2xl font-black">{weeklyDigest.data.upcoming_renewals?.length || 0}</p>
              </div>
              <div className="bg-slate-800 rounded-xl p-3">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Team Task Avg</h3>
                {weeklyDigest.data.task_performance?.length > 0 ? (
                  <p className="text-2xl font-black text-brand-primary">
                    {Math.round(weeklyDigest.data.task_performance.reduce((acc: number, p: any) => acc + (p.completed_count/p.total_count), 0) / weeklyDigest.data.task_performance.length * 100)}%
                  </p>
                ) : (
                  <p className="text-2xl font-black text-slate-500">N/A</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Header & Main Progress */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <ListTodo size={20} className="text-brand-primary" />
              <h1 className="text-2xl font-black text-slate-900">My Day</h1>
            </div>
            <p className="text-xs text-slate-400 font-bold tracking-wider uppercase">{today}</p>
            {hasOnboarding && (
              <button
                onClick={() => {
                  if (currentUser) exportPipelineToExcel(currentUser.user_id, false);
                }}
                className="mt-2 flex items-center gap-1.5 px-3 py-1.5 bg-brand-primary text-white rounded-xl text-xs font-black cursor-pointer hover:bg-brand-secondary transition-all"
              >
                <Download size={14} /> Pipeline
              </button>
            )}
          </div>
          
          <div className="flex items-center gap-3 bg-white rounded-2xl border border-slate-100 shadow-sm px-4 py-3">
            <div className="relative h-12 w-12">
              <svg className="h-12 w-12 -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="15.9" fill="none" stroke="#f1f5f9" strokeWidth="3" />
                <circle
                  cx="18" cy="18" r="15.9" fill="none" stroke="#6366f1" strokeWidth="3"
                  strokeDasharray={`${progressPct} ${100 - progressPct}`} strokeLinecap="round"
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-[11px] font-black text-brand-primary">
                {progressPct}%
              </span>
            </div>
            <div>
              <p className="text-sm font-black text-slate-900">{done.length}/{tasks.length}</p>
              <p className="text-[10px] text-slate-400 font-bold">Tasks done</p>
            </div>
          </div>
        </div>

        {/* ─── Role-Scoped KPIs ─────────────────────────────────────────── */}
        {!loading && (hasOnboarding || hasSupport || isFieldStaff) && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Common: Tasks Completed */}
            <div className="bg-white rounded-2xl border border-slate-100 p-4 flex flex-col justify-between">
              <CheckSquare size={16} className="text-emerald-500 mb-2" />
              <div>
                <p className="text-2xl font-black text-slate-900">{done.length}</p>
                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Tasks Done</p>
              </div>
            </div>
            
            {/* Onboarding KPIs */}
            {hasOnboarding && (
              <>
                <div className="bg-white rounded-2xl border border-slate-100 p-4 flex flex-col justify-between">
                  <PhoneCall size={16} className="text-brand-primary mb-2" />
                  <div>
                    <p className="text-2xl font-black text-slate-900">{callsToday}</p>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Calls Today</p>
                  </div>
                </div>
                <div className="bg-white rounded-2xl border border-slate-100 p-4 flex flex-col justify-between">
                  <Trophy size={16} className="text-amber-500 mb-2" />
                  <div>
                    <p className="text-2xl font-black text-slate-900">{leadsConverted}</p>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Converted</p>
                  </div>
                </div>
              </>
            )}
            
            {/* Support KPIs */}
            {hasSupport && (
              <>
                <div className="bg-white rounded-2xl border border-slate-100 p-4 flex flex-col justify-between">
                  <CheckCircle2 size={16} className="text-brand-secondary mb-2" />
                  <div>
                    <p className="text-2xl font-black text-slate-900">{queriesResolvedToday}</p>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Resolved Today</p>
                  </div>
                </div>
                <div className="bg-white rounded-2xl border border-slate-100 p-4 flex flex-col justify-between">
                  <AlertCircle size={16} className="text-rose-500 mb-2" />
                  <div>
                    <p className="text-2xl font-black text-slate-900">{openQueries}</p>
                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Open Queries</p>
                  </div>
                </div>
              </>
            )}

            {/* Field KPIs */}
            {isFieldStaff && !hasOnboarding && !hasSupport && (
              <div className="bg-white rounded-2xl border border-slate-100 p-4 flex flex-col justify-between">
                <Target size={16} className="text-indigo-500 mb-2" />
                <div>
                  <p className="text-2xl font-black text-slate-900">{progressPct}%</p>
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">On-Time Rate</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─── Follow-up Alerts ────────────────────────────────────────── */}
        {!loading && followUpsToday.length > 0 && (
          <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 flex items-start gap-3 shadow-sm mb-4 animate-in fade-in slide-in-from-top-4">
            <AlertCircle size={20} className="text-rose-500 shrink-0 mt-0.5" />
            <div>
              <h3 className="text-sm font-black text-rose-700">Action Required: Scheduled Follow-ups</h3>
              <p className="text-xs text-rose-600 font-semibold mt-1">
                You have {followUpsToday.length} follow-up{followUpsToday.length > 1 ? "s" : ""} scheduled for today. Check your Pending tasks below.
              </p>
            </div>
          </div>
        )}

        {/* ─── Task Lists ──────────────────────────────────────────────── */}
        <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1, padding: 12, borderRadius: 10, background: "#fef2f2", textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#991b1b" }}>{stats.pendingToday}</div>
            <div style={{ fontSize: 12, color: "#888" }}>Tasks pending</div>
          </div>
          <div style={{ flex: 1, padding: 12, borderRadius: 10, background: "#eff6ff", textAlign: "center" }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#1e40af" }}>{stats.scheduledLater}</div>
            <div style={{ fontSize: 12, color: "#888" }}>Follow-ups scheduled later</div>
          </div>
        </div>
        {loading && (
          <div className="text-center py-16 text-slate-400 text-sm font-semibold animate-pulse">
            Loading your tasks and performance data...
          </div>
        )}

        {!loading && tasks.length === 0 && (
          <div className="text-center py-16 bg-white rounded-3xl border border-slate-100">
            <CheckCircle2 size={40} className="mx-auto text-emerald-400 mb-3" />
            <p className="font-black text-slate-700">No tasks for today.</p>
            <p className="text-xs text-slate-400 mt-1">Enjoy the quiet — or ask your manager to assign something.</p>
          </div>
        )}

        {/* In Progress */}
        {inProgress.length > 0 && (
          <section>
            <h2 className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
              <Clock size={12} className="text-amber-500" /> In Progress
            </h2>
            <div className="space-y-2">
              {inProgress.map((task) => (
                <TaskCard
                  key={task.task_id}
                  task={task}
                  markingId={markingId}
                  onComplete={handleComplete}
                  onDelete={handleDelete}
                  currentUser={currentUser}
                  isAdmin={isAdmin}
                  accent="border-l-amber-400"
                />
              ))}
            </div>
          </section>
        )}

        {/* Pending */}
        {pending.length > 0 && (
          <section>
            <h2 className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
              <AlertCircle size={12} className="text-rose-400" /> Pending ({pending.length})
            </h2>
            <div className="space-y-2">
              {pending.map((task) => (
                <TaskCard
                  key={task.task_id}
                  task={task}
                  markingId={markingId}
                  onStart={handleStart}
                  onComplete={handleComplete}
                  onDelete={handleDelete}
                  currentUser={currentUser}
                  isAdmin={isAdmin}
                  accent="border-l-brand-primary"
                />
              ))}
            </div>
          </section>
        )}

        {/* Completed */}
        {done.length > 0 && (
          <section>
            <h2 className="text-[11px] font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
              <CheckCircle2 size={12} className="text-emerald-500" /> Completed
            </h2>
            <div className="space-y-2">
              {done.map((task) => (
                <div
                  key={task.task_id}
                  className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-slate-50 border border-slate-100 opacity-60"
                >
                  <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
                  <span className="text-sm text-slate-500 font-semibold line-through">{task.title}</span>
                  {task.completed_at && (
                    <span className="ml-auto text-[10px] text-slate-400 font-mono shrink-0">
                      {new Date(task.completed_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Missed */}
        {missed.length > 0 && (
          <section>
            <h2 className="text-[11px] font-black text-rose-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
              <AlertCircle size={12} /> Missed
            </h2>
            <div className="space-y-2">
              {missed.map((task) => (
                <div
                  key={task.task_id}
                  className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-rose-50 border border-rose-100"
                >
                  <AlertCircle size={16} className="text-rose-400 shrink-0" />
                  <span className="text-sm text-rose-600 font-semibold">{task.title}</span>
                  <span className="ml-auto text-[10px] text-rose-400 font-bold shrink-0">Missed</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Task card sub-component
// ─────────────────────────────────────────────────────────────────────────────

const PRIORITY_DOT_COLORS: Record<string, string> = {
  High: "bg-rose-500",
  Medium: "bg-amber-400",
  Low: "bg-emerald-500",
};

const PRIORITY_BADGE_STYLES: Record<string, string> = {
  High: "bg-rose-50 text-rose-600 border-rose-200",
  Medium: "bg-amber-50 text-amber-700 border-amber-200",
  Low: "bg-emerald-50 text-emerald-600 border-emerald-200",
};

function TaskCard({
  task,
  markingId,
  onStart,
  onComplete,
  onDelete,
  currentUser,
  isAdmin,
  accent,
}: {
  task: LocalTask;
  markingId: string | null;
  onStart?: (t: LocalTask) => void;
  onComplete: (t: LocalTask) => void;
  onDelete?: (t: LocalTask) => void;
  currentUser: any;
  isAdmin: boolean;
  accent: string;
}) {
  const isActing = markingId === task.task_id;
  const canDelete = isAdmin || currentUser?.user_id === task.assigned_by;

  return (
    <div
      className={`flex items-start gap-3 px-4 py-4 rounded-2xl bg-white border border-slate-100 shadow-sm border-l-4 ${accent} transition-all hover:shadow-md`}
    >
      <span className={`mt-1.5 h-2.5 w-2.5 rounded-full shrink-0 ${PRIORITY_DOT_COLORS[task.priority]}`} />

      <div className="flex-1 min-w-0">
        <p className="font-black text-sm text-slate-900 leading-snug">{task.title}</p>
        {task.description && (
          <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{task.description}</p>
        )}
        <div className="flex items-center gap-2 mt-2">
          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${PRIORITY_BADGE_STYLES[task.priority]}`}>
            {task.priority}
          </span>
          {task.source === "manual" && (
            <span className="text-[10px] font-bold text-brand-primary/70 px-2 py-0.5 rounded-full border border-brand-primary/20 bg-brand-primary/5">
              Manual
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 shrink-0">
        {task.status === "Pending" && onStart && (
          <button
            onClick={() => onStart(task)}
            disabled={!!markingId}
            className="px-3 py-1.5 text-[11px] font-black rounded-xl border border-brand-primary/30 text-brand-primary hover:bg-brand-primary/5 transition-all disabled:opacity-50 cursor-pointer"
          >
            {isActing ? "..." : "Start"}
          </button>
        )}
        <button
          onClick={() => onComplete(task)}
          disabled={!!markingId}
          className="px-3 py-1.5 text-[11px] font-black rounded-xl bg-brand-primary text-white hover:bg-brand-secondary transition-all shadow-sm shadow-brand-primary/20 disabled:opacity-50 cursor-pointer"
        >
          {isActing ? "..." : "Done ✓"}
        </button>
        {onDelete && canDelete && (
          <button
            onClick={() => onDelete(task)}
            disabled={!!markingId}
            className="px-3 py-1.5 text-[11px] font-black rounded-xl border border-rose-200 text-rose-500 hover:bg-rose-50 hover:border-rose-300 transition-all disabled:opacity-50 cursor-pointer flex items-center justify-center"
            title="Delete Task"
          >
            <Trash2 size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
