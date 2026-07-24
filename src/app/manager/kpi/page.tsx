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
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";

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
      tickets_resolved: 0,
      calls_made: callsMade,
    };
  });
}

function AttBadge({ status }: { status: string }) {
  const variant = status === "Present" ? "success" : status === "Late" ? "warning" : "danger";
  return <Chip variant={variant} size="sm">{status}</Chip>;
}

export default function ManagerKpiPage() {
  const { currentUser, isAdmin, hasOnboarding, hasSupport } = useAuth();
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
    <div className="space-y-6 w-full max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 size={20} className="text-[var(--brand-500)]" />
          <h1 className="text-2xl font-black text-[var(--text-primary)]">Team KPI Dashboard</h1>
        </div>
        <div className="flex items-center gap-2">
          <Calendar size={14} className="text-[var(--text-muted)]" />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="px-3 py-1.5 bg-[var(--surface-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-sm)] text-xs font-bold text-[var(--text-primary)] focus:outline-none focus:border-[var(--brand-500)]"
          />
        </div>
      </div>

      {/* Tab Switcher */}
      <div className="flex p-1 bg-[var(--surface-secondary)] rounded-[var(--radius-md)] w-fit gap-1.5">
        <button
          onClick={() => setActiveTab("Team")}
          className={`flex items-center gap-2 px-4 py-1.5 rounded-[var(--radius-sm)] text-xs font-bold transition-all cursor-pointer ${
            activeTab === "Team"
              ? "bg-[var(--surface-primary)] text-[var(--brand-500)] shadow-xs"
              : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          }`}
        >
          <Users size={14} /> Team Performance
        </button>
        <button
          onClick={() => setActiveTab("Funnel")}
          className={`flex items-center gap-2 px-4 py-1.5 rounded-[var(--radius-sm)] text-xs font-bold transition-all cursor-pointer ${
            activeTab === "Funnel"
              ? "bg-[var(--surface-primary)] text-[var(--brand-500)] shadow-xs"
              : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          }`}
        >
          <Layers size={14} /> Pipeline Funnel
        </button>
      </div>

      {activeTab === "Team" ? (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 w-full">
            <Card className="p-4 flex flex-col justify-between">
              <span className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest">Active Staff</span>
              <span className="text-2xl font-black text-[var(--text-primary)] mt-1">{rows.length}</span>
            </Card>
            <Card className="p-4 flex flex-col justify-between">
              <span className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest">Avg Completion</span>
              <span className="text-2xl font-black text-[var(--brand-500)] mt-1">{avgCompletion}%</span>
            </Card>
            <Card className="p-4 flex flex-col justify-between border-[var(--status-warning)]/20 bg-[var(--status-warning-soft)]/30">
              <span className="text-[10px] font-black text-[var(--status-warning)] uppercase tracking-widest">Flagged Staff</span>
              <span className="text-2xl font-black text-[var(--status-warning)] mt-1">{flagged.length}</span>
            </Card>
            <Card className="p-4 flex flex-col justify-between border-[var(--status-success)]/20 bg-[var(--status-success-soft)]/30">
              <span className="text-[10px] font-black text-[var(--status-success)] uppercase tracking-widest">Present Today</span>
              <span className="text-2xl font-black text-[var(--status-success)] mt-1">
                {rows.filter((r) => r.attendance_status === "Present").length}
              </span>
            </Card>
          </div>

          {/* Chart Section */}
          {rows.length > 0 && (
            <Card className="p-6 space-y-4">
              <h2 className="text-xs font-black text-[var(--text-primary)] uppercase tracking-wider">
                Task Completion Rate (%)
              </h2>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={rows} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e8eaee" vertical={false} />
                    <XAxis dataKey="name" stroke="#7b8490" fontSize={11} tickLine={false} />
                    <YAxis stroke="#7b8490" fontSize={11} domain={[0, 100]} tickLine={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#ffffff",
                        borderColor: "#dce0e5",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                    />
                    <Bar dataKey="completion_rate" radius={[4, 4, 0, 0]}>
                      {rows.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={entry.completion_rate >= 80 ? "#18794e" : entry.completion_rate >= 50 ? "#5b5bd6" : "#c73535"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}

          {/* Team KPI Table */}
          <Card className="overflow-hidden p-0 border border-[var(--border-subtle)]">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[var(--surface-secondary)] border-b border-[var(--border-subtle)] text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest">
                    <th className="p-4 pl-6">Team Member</th>
                    <th className="p-4">Attendance</th>
                    <th className="p-4">Completion %</th>
                    <th className="p-4">Assigned / Done</th>
                    {showOnboardingCols && <th className="p-4">Converted</th>}
                    {showSupportCols && <th className="p-4">Calls Made</th>}
                  </tr>
                </thead>
                <tbody className="text-xs divide-y divide-[var(--border-subtle)]">
                  {rows.map((row) => (
                    <tr key={row.user_id} className="hover:bg-[var(--surface-hover)] transition-colors">
                      <td className="p-4 pl-6 font-bold text-[var(--text-primary)]">{row.name}</td>
                      <td className="p-4"><AttBadge status={row.attendance_status} /></td>
                      <td className="p-4 font-mono font-black text-[var(--brand-500)]">{row.completion_rate}%</td>
                      <td className="p-4 font-mono font-semibold text-[var(--text-secondary)]">
                        {row.tasks_completed} / {row.tasks_assigned}
                      </td>
                      {showOnboardingCols && <td className="p-4 font-bold text-[var(--text-primary)]">{row.leads_converted}</td>}
                      {showSupportCols && <td className="p-4 font-bold text-[var(--text-primary)]">{row.calls_made}</td>}
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-xs text-[var(--text-muted)] font-semibold">
                        No KPI snapshots found for {date}.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : (
        <FunnelTab />
      )}
    </div>
  );
}
