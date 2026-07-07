"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import { CONVERTED_STAGES } from "@/lib/pipelineRules";
import { db } from "@/lib/db";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
} from "recharts";
import {
  TrendingUp,
  Users,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  BarChart3,
  AlertCircle,
  Layers
} from "lucide-react";
import FunnelTab from "./FunnelTab";

interface KpiRow {
  user_id: string;
  name: string;
  completion_rate: number;
  tasks_assigned: number;
  tasks_completed: number;
  attendance_status: string;
  leads_converted: number;
  tickets_resolved: number;
  calls_made: number;
}

// Offline mock — aggregated from local Dexie data when Supabase is not configured
async function buildLocalKpiRows(date: string): Promise<KpiRow[]> {
  const users = await db.users.toArray();
  const tasks = await db.tasks.where("due_date").equals(date).toArray();
  const attendance = await db.attendance.toArray();
  const leads = await db.leads.toArray();
  const calls = await db.call_logs.toArray();

  return users.map((u) => {
    const userTasks = tasks.filter((t) => t.assigned_to === u.user_id);
    const completed = userTasks.filter((t) => t.status === "Completed").length;
    const assigned = userTasks.length;
    const att = attendance.find((a) => a.user_id === u.user_id && a.date === date);
    const converted = leads.filter(
      (l) =>
        l.assigned_to === u.user_id &&
        CONVERTED_STAGES.includes(l.status as any)
    ).length;
    const callsMade = calls.filter((c) => c.user_id === u.user_id && c.timestamp.startsWith(date)).length;

    return {
      user_id: u.user_id,
      name: u.name,
      completion_rate: assigned === 0 ? 0 : Math.round((completed / assigned) * 100),
      tasks_assigned: assigned,
      tasks_completed: completed,
      attendance_status: att ? (att.clock_in ? "Present" : "Absent") : "Absent",
      leads_converted: converted,
      tickets_resolved: 0, // Mock for queries
      calls_made: callsMade,
    };
  });
}

function AttBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    Present: "bg-emerald-50 text-emerald-600 border-emerald-200",
    Late: "bg-amber-50 text-amber-700 border-amber-200",
    Absent: "bg-rose-50 text-rose-600 border-rose-200",
  };
  return (
    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full border ${styles[status] ?? "bg-slate-50 text-slate-500 border-slate-200"}`}>
      {status}
    </span>
  );
}

export default function ManagerKpiPage() {
  const { currentUser, capabilities, isAdmin, hasOnboarding, hasSupport } = useAuth();
  const [rows, setRows] = useState<KpiRow[]>([]);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"Team" | "Funnel">("Team");

  useEffect(() => {
    if (!currentUser) return;
    setLoading(true);

    (async () => {
      if (isSupabaseConfigured) {
        const { data } = await supabase
          .from("kpi_daily_snapshot")
          .select(
            "user_id, completion_rate, tasks_assigned, tasks_completed, attendance_status, leads_converted, tickets_resolved, users!inner(name)"
          )
          .eq("date", date);

        const mapped: KpiRow[] = (data || []).map((r: any) => ({
          user_id: r.user_id,
          name: r.users.name,
          completion_rate: Number(r.completion_rate) || 0,
          tasks_assigned: r.tasks_assigned || 0,
          tasks_completed: r.tasks_completed || 0,
          attendance_status: r.attendance_status ?? "Absent",
          leads_converted: r.leads_converted || 0,
          tickets_resolved: r.tickets_resolved || 0,
          calls_made: r.calls_made || 0,
        }));
        let finalMapped = mapped;
        if (!isAdmin && currentUser) {
          finalMapped = mapped.filter((r) => r.user_id === currentUser.user_id);
        }
        finalMapped.sort((a, b) => b.completion_rate - a.completion_rate);
        setRows(finalMapped);
      } else {
        // Offline-demo mode — build from local IndexedDB
        const local = await buildLocalKpiRows(date);
        let finalLocal = local;
        if (!isAdmin && currentUser) {
          finalLocal = local.filter((r) => r.user_id === currentUser.user_id);
        }
        finalLocal.sort((a, b) => b.completion_rate - a.completion_rate);
        setRows(finalLocal);
      }
      setLoading(false);
    })();
  }, [date, isAdmin, currentUser]);

  const showOnboardingCols = isAdmin || hasOnboarding;
  const showSupportCols = isAdmin || hasSupport;



  const flagged = rows.filter(
    (r) => r.completion_rate < 50 || r.attendance_status !== "Present"
  );
  const avgCompletion =
    rows.length === 0
      ? 0
      : Math.round(rows.reduce((s, r) => s + (r.completion_rate || 0), 0) / rows.length) || 0;

  return (
      <div className="space-y-6 w-full">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 size={20} className="text-brand-primary" />
            <h1 className="text-2xl font-black text-slate-900">Team KPI Dashboard</h1>
          </div>
          <div className="flex items-center gap-2">
            <Calendar size={14} className="text-slate-400" />
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-semibold text-slate-900 focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10 transition-all"
            />
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex bg-slate-100 p-1 rounded-xl w-fit">
          <button
            onClick={() => setActiveTab("Team")}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${
              activeTab === "Team"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <Users size={16} /> Team Performance
          </button>
          <button
            onClick={() => setActiveTab("Funnel")}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${
              activeTab === "Funnel"
                ? "bg-white text-slate-900 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            <Layers size={16} /> Pipeline Funnel
          </button>
        </div>

        {activeTab === "Team" ? (
          <>
            {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 w-full">
          {[
            { label: "Team Size", value: rows.length, icon: Users, color: "text-brand-primary" },
            { label: "Avg Completion", value: `${avgCompletion}%`, icon: TrendingUp, color: "text-emerald-500" },
            { label: "Needs Attention", value: flagged.length, icon: AlertTriangle, color: "text-amber-500" },
            {
              label: "Full Attendance",
              value: rows.filter((r) => r.attendance_status === "Present").length,
              icon: CheckCircle2,
              color: "text-emerald-500",
            },
          ].map((card) => (
            <div key={card.label} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
              <card.icon size={18} className={card.color + " mb-2"} />
              <p className="text-2xl font-black text-slate-900">{card.value}</p>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">{card.label}</p>
            </div>
          ))}
        </div>

        {loading && (
          <div className="text-center py-16 text-slate-400 text-sm font-semibold animate-pulse">
            Loading KPI data…
          </div>
        )}

        {/* Bar chart */}
        {!loading && rows.length > 0 && (
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 min-w-0 overflow-hidden">
            <h2 className="text-sm font-black text-slate-700 mb-4">Task Completion Rate (%)</h2>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={rows} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fontWeight: 700 }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(v) => [`${v}%`, "Completion"]}
                  contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }}
                />
                <Bar dataKey="completion_rate" radius={[6, 6, 0, 0]}>
                  {rows.map((r, i) => (
                    <Cell
                      key={i}
                      fill={
                        r.completion_rate >= 75
                          ? "#22c55e"
                          : r.completion_rate >= 50
                          ? "#6366f1"
                          : "#f43f5e"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Needs Attention panel */}
        {!loading && flagged.length > 0 && (
          <div className="bg-rose-50 border border-rose-200 rounded-2xl p-5">
            <h3 className="text-sm font-black text-rose-700 mb-3 flex items-center gap-2">
              <AlertTriangle size={16} /> Needs Attention
            </h3>
            <div className="space-y-2">
              {flagged.map((r) => (
                <div
                  key={r.user_id}
                  className="flex items-center justify-between text-sm text-rose-700 bg-white rounded-xl border border-rose-100 px-4 py-2.5"
                >
                  <span className="font-bold">{r.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="font-black text-rose-500">{r.completion_rate}%</span>
                    <AttBadge status={r.attendance_status} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Full leaderboard table */}
        {!loading && rows.length > 0 && (
          <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100">
              <h2 className="text-sm font-black text-slate-700">Full Leaderboard</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left">
                    {["#", "Name", "Completion", "Tasks", "Attendance", 
                      ...(showOnboardingCols ? ["Calls", "Leads Conv."] : []),
                      ...(showSupportCols ? ["Tickets"] : [])
                    ].map((h) => (
                      <th key={h} className="px-4 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.user_id} className="border-t border-slate-50 hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3 text-xs font-black text-slate-300">#{i + 1}</td>
                      <td className="px-4 py-3 font-black text-slate-900">{r.name}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`font-black text-sm ${
                            r.completion_rate >= 75
                              ? "text-emerald-600"
                              : r.completion_rate >= 50
                              ? "text-brand-primary"
                              : "text-rose-500"
                          }`}
                        >
                          {r.completion_rate}%
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700 font-semibold">
                        {r.tasks_completed}/{r.tasks_assigned}
                      </td>
                      <td className="px-4 py-3">
                        <AttBadge status={r.attendance_status} />
                      </td>
                      {showOnboardingCols && (
                        <>
                          <td className="px-4 py-3 font-semibold text-slate-700">{r.calls_made}</td>
                          <td className="px-4 py-3 font-semibold text-slate-700">{r.leads_converted}</td>
                        </>
                      )}
                      {showSupportCols && (
                        <td className="px-4 py-3 font-semibold text-slate-700">{r.tickets_resolved}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!isSupabaseConfigured && (
          <p className="text-center text-[10px] text-slate-400 font-bold">
            KPI data sourced from local IndexedDB (offline demo mode). Connect Supabase for live nightly snapshots.
          </p>
        )}
        </>
        ) : (
          <FunnelTab />
        )}
      </div>
  );
}
