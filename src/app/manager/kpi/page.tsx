"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import { TeamKpiRow } from "@/lib/teamKpi/contract";
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
  Layers
} from "lucide-react";
import FunnelTab from "./FunnelTab";
import { Chip } from "@/components/ui/Chip";
import { PageHeader } from "@/components/ui/PageHeader";
import { MetricCard } from "@/components/ui/MetricCard";
import { Input } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";

function AttBadge({ status }: { status: string }) {
  const variant = status === "Present" ? "success" : status === "Late" ? "warning" : "danger";
  return <Chip variant={variant} size="sm">{status}</Chip>;
}

export default function ManagerKpiPage() {
  const { currentUser, isAdmin } = useAuth();
  const [rows, setRows] = useState<TeamKpiRow[]>([]);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"Team" | "Funnel">("Team");

  useEffect(() => {
    if (!currentUser) return;
    setLoading(true);

    (async () => {
      if (!isSupabaseConfigured) {
        console.warn("Supabase not configured, cannot load KPI data.");
        setRows([]);
        setLoading(false);
        return;
      }
      const { data, error } = await supabase.rpc("get_team_kpi_daily", { target_date: date });
      if (error || !data) {
        console.error("Failed to load KPI data:", error);
        setRows([]);
      } else {
        let finalMapped: TeamKpiRow[] = typeof data === 'string' ? JSON.parse(data) : data;
        if (!isAdmin && currentUser) {
          finalMapped = finalMapped.filter((r) => r.user_id === currentUser.user_id);
        }
        finalMapped.sort((a, b) => b.completion_rate - a.completion_rate);
        setRows(finalMapped);
      }
      setLoading(false);
    })();
  }, [date, isAdmin, currentUser]);

  const flagged = rows.filter(
    (r) => r.completion_rate < 50 || r.attendance_status !== "Present"
  );
  const avgCompletion =
    rows.length === 0
      ? 0
      : Math.round(rows.reduce((s, r) => s + (r.completion_rate || 0), 0) / rows.length) || 0;

  const presentCount = rows.filter((row) => row.attendance_status === "Present").length;

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Performance intelligence"
        icon={<BarChart3 size={18} />}
        title={isAdmin ? "Team performance" : "My performance"}
        description="Compare execution, attendance, conversion, and pipeline health without losing the underlying operational detail."
        actions={
          <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} leftIcon={<Calendar size={15} />} containerClassName="w-full sm:w-[190px]" aria-label="KPI date" />
        }
      />

      <div className="segmented-control w-fit" aria-label="Performance report view">
        <button type="button" aria-pressed={activeTab === "Team"} onClick={() => setActiveTab("Team")}><span className="flex items-center gap-2"><Users size={14} /> Team execution</span></button>
        <button type="button" aria-pressed={activeTab === "Funnel"} onClick={() => setActiveTab("Funnel")}><span className="flex items-center gap-2"><Layers size={14} /> Pipeline funnel</span></button>
      </div>

      {activeTab === "Team" ? (
        <>
          <div className="metric-grid">
            <MetricCard label="Active staff" value={rows.length} icon={<Users size={17} />} tone="neutral" note="People included in the selected snapshot" />
            <MetricCard label="Average completion" value={`${avgCompletion}%`} icon={<TrendingUp size={17} />} tone="brand" note="Mean task completion across visible staff" />
            <MetricCard label="Needs attention" value={flagged.length} icon={<AlertTriangle size={17} />} tone="warning" note="Low completion or missing attendance" />
            <MetricCard label="Present" value={presentCount} icon={<CheckCircle2 size={17} />} tone="success" note={`Attendance recorded for ${date}`} />
          </div>

          {loading ? (
            <section className="surface-panel grid min-h-[360px] place-items-center"><p className="text-[13px] font-medium text-[var(--text-muted)]">Loading KPI snapshot…</p></section>
          ) : rows.length > 0 ? (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
              <section className="surface-panel overflow-hidden" aria-labelledby="completion-chart-title">
                <div className="border-b border-[var(--border-subtle)] p-5"><p className="section-kicker">Execution distribution</p><h2 id="completion-chart-title" className="mt-1 section-title">Task completion rate</h2></div>
                <div className="h-[320px] p-4 sm:p-5">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={rows} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                      <XAxis dataKey="name" stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} />
                      <YAxis stroke="var(--text-muted)" fontSize={11} domain={[0, 100]} tickLine={false} axisLine={false} />
                      <Tooltip cursor={{ fill: "var(--surface-hover)" }} contentStyle={{ backgroundColor: "var(--surface-elevated)", borderColor: "var(--border-default)", borderRadius: "10px", color: "var(--text-primary)", fontSize: "12px", boxShadow: "var(--shadow-popover)" }} />
                      <Bar dataKey="completion_rate" radius={[5, 5, 0, 0]} maxBarSize={48}>
                        {rows.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.completion_rate >= 80 ? "var(--status-success)" : entry.completion_rate >= 50 ? "var(--brand-500)" : "var(--status-danger)"} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>

              <aside className="surface-panel overflow-hidden" aria-labelledby="attention-list-title">
                <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-5"><p className="section-kicker">Management focus</p><h2 id="attention-list-title" className="mt-1 section-title">People needing attention</h2></div>
                <div className="max-h-[320px] space-y-2 overflow-y-auto p-4">
                  {flagged.length ? flagged.map((row) => (
                    <div key={row.user_id} className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-3">
                      <div className="flex items-center justify-between gap-3"><p className="truncate text-[12px] font-semibold text-[var(--text-primary)]">{row.name}</p><span className="text-[12px] font-semibold tabular-nums text-[var(--status-warning)]">{row.completion_rate}%</span></div>
                      <div className="mt-2 flex flex-wrap gap-2"><AttBadge status={row.attendance_status} /><Chip variant={row.completion_rate < 50 ? "danger" : "neutral"} size="sm">{row.tasks_completed}/{row.tasks_assigned} tasks</Chip></div>
                    </div>
                  )) : <EmptyState compact icon={<CheckCircle2 size={20} />} title="No performance flags" description="Visible staff meet the current attendance and completion thresholds." />}
                </div>
              </aside>
            </div>
          ) : null}

          <section className="data-table-shell" aria-labelledby="kpi-table-title">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-4"><div><p className="section-kicker">Detailed scorecard</p><h2 id="kpi-table-title" className="mt-1 section-title">Team KPI register</h2></div><Chip variant="neutral" size="sm">{date}</Chip></div>
            {rows.length === 0 && !loading ? (
              <div className="p-5"><EmptyState icon={<BarChart3 size={21} />} title="No KPI snapshot" description={`No performance data is available for ${date}.`} /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-[960px]">
                  <thead><tr><th>Team member</th><th>Role</th><th>Attendance</th><th>Completion</th><th>Total Work</th><th>Tasks (Done/Asg)</th><th>Calls</th><th>Queries</th><th>Mappings</th><th>Last Active</th></tr></thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.user_id}>
                        <td><p className="font-semibold text-[var(--text-primary)]">{row.name}</p></td>
                        <td><span className="text-[12px] font-medium text-[var(--text-muted)] capitalize">{row.role?.replace(/_/g, " ")}</span></td>
                        <td><AttBadge status={row.attendance_status} /></td>
                        <td><div className="flex min-w-[140px] items-center gap-3"><div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--surface-tertiary)]"><div className={`h-full rounded-full ${row.completion_rate >= 80 ? "bg-[var(--status-success)]" : row.completion_rate >= 50 ? "bg-[var(--brand-500)]" : "bg-[var(--status-danger)]"}`} style={{ width: `${Math.min(row.completion_rate, 100)}%` }} /></div><span className="w-10 text-right font-semibold tabular-nums text-[var(--text-primary)]">{row.completion_rate}%</span></div></td>
                        <td className="font-semibold tabular-nums text-[var(--text-primary)]">{row.total_completed_work}</td>
                        <td className="font-mono text-[12px]">{row.tasks_completed} / {row.tasks_assigned}</td>
                        <td className="font-semibold tabular-nums text-[var(--text-primary)]">{row.calls_made}</td>
                        <td className="font-semibold tabular-nums text-[var(--text-primary)]">{row.queries_handled}</td>
                        <td className="font-semibold tabular-nums text-[var(--text-primary)]">{row.mappings_completed}</td>
                        <td className="text-[12px] text-[var(--text-muted)]">{row.latest_activity_time ? new Date(row.latest_activity_time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : "N/A"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : <FunnelTab />}
    </div>
  );
}
