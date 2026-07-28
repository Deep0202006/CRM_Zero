"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/context/AuthContext";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import {
  EMPTY_TEAM_KPI_TOTALS,
  getTeamKpiErrorMessage,
  parseTeamKpiResponse,
  TeamKpiResponse,
  TeamKpiRow,
} from "@/lib/teamKpi/contract";
import { getCurrentISTDate, IST_TIMEZONE } from "@/lib/dateTime";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  Activity,
  AlertCircle,
  BarChart3,
  Calendar,
  CheckCircle2,
  Layers,
  Link2,
  MessageSquare,
  PhoneCall,
  RefreshCw,
  ShieldAlert,
  Users,
} from "lucide-react";
import FunnelTab from "./FunnelTab";
import { Chip } from "@/components/ui/Chip";
import { PageHeader } from "@/components/ui/PageHeader";
import { MetricCard } from "@/components/ui/MetricCard";
import { Input } from "@/components/ui/Input";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";

const REALTIME_TABLES = [
  "team_activity_events",
  "users",
  "user_capabilities",
] as const;

function formatActivityTime(value: string | null): string {
  if (!value) return "No work recorded";

  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
}

function WorkMixRow({
  label,
  value,
  total,
  icon,
  barClassName,
}: {
  label: string;
  value: number;
  total: number;
  icon: ReactNode;
  barClassName: string;
}) {
  const percentage = total > 0 ? Math.round((value / total) * 100) : 0;

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2 text-[12px] font-semibold text-[var(--text-secondary)]">
          <span className="text-[var(--text-muted)]">{icon}</span>
          <span className="truncate">{label}</span>
        </span>
        <span className="font-semibold tabular-nums text-[var(--text-primary)]">{value}</span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--surface-tertiary)]">
        <div className={`h-full rounded-full ${barClassName}`} style={{ width: `${percentage}%` }} />
      </div>
      <p className="mt-2 text-[10px] font-medium tabular-nums text-[var(--text-muted)]">{percentage}% of recorded work</p>
    </div>
  );
}

export default function ManagerKpiPage() {
  const { currentUser, isAdmin, isLoading: isAuthLoading } = useAuth();
  const [report, setReport] = useState<TeamKpiResponse | null>(null);
  const [date, setDate] = useState(getCurrentISTDate());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"Team" | "Funnel">("Team");
  const requestSequence = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const confirmedAt = useRef(0);
  const realtimeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadTeamKpi = useCallback(async (background = false) => {
    if (!currentUser || !isAdmin) return;

    const requestId = ++requestSequence.current;
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    if (background) setRefreshing(true);
    else setLoading(true);

    try {
      if (!isSupabaseConfigured) {
        throw new Error("Supabase environment variables are not configured.");
      }

      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const accessToken = sessionData.session?.access_token;
      if (sessionError || !accessToken) {
        throw { code: "28000", message: "Authentication required" };
      }

      const response = await fetch(`/api/team-kpi?date=${encodeURIComponent(date)}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
        signal: controller.signal,
      });
      const contentType = response.headers.get("content-type") ?? "";
      const data: unknown = contentType.includes("application/json")
        ? await response.json()
        : {
            code: "TEAM_KPI_INVALID_RESPONSE",
            message: `Team KPI returned ${response.status} ${response.statusText} instead of JSON.`,
          };

      if (requestId !== requestSequence.current) return;
      if (!response.ok) throw data;

      const parsed = parseTeamKpiResponse(data);
      if (parsed.target_date !== date) {
        throw new Error("Team KPI returned data for a different business date.");
      }

      setReport(parsed);
      confirmedAt.current = Date.now();
      setError(null);
      setWarning(
        parsed.warnings.length > 0
          ? `Some KPI sources need attention: ${parsed.warnings.map((item) => item.message).join(" ")}`
          : null,
      );
    } catch (caughtError: unknown) {
      if (requestId !== requestSequence.current) return;
      if (caughtError instanceof DOMException && caughtError.name === "AbortError") return;
      console.error("Team KPI refresh failed", caughtError);
      setError(getTeamKpiErrorMessage(caughtError));
    } finally {
      if (requestId === requestSequence.current) {
        activeRequest.current = null;
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [currentUser, date, isAdmin]);

  useEffect(() => () => activeRequest.current?.abort(), []);

  useEffect(() => {
    if (isAuthLoading || !currentUser || !isAdmin) return;
    void loadTeamKpi(false);
  }, [currentUser, isAdmin, isAuthLoading, loadTeamKpi]);

  useEffect(() => {
    if (!currentUser || !isAdmin || !isSupabaseConfigured) return;

    const scheduleRefresh = () => {
      if (realtimeTimer.current) clearTimeout(realtimeTimer.current);
      realtimeTimer.current = setTimeout(() => {
        void loadTeamKpi(true);
      }, 750);
    };

    let channel = supabase.channel(`team-kpi-${currentUser.user_id}`);
    for (const table of REALTIME_TABLES) {
      channel = channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        scheduleRefresh,
      );
    }
    channel.subscribe();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && Date.now() - confirmedAt.current > 60_000) {
        scheduleRefresh();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (realtimeTimer.current) clearTimeout(realtimeTimer.current);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      void supabase.removeChannel(channel);
    };
  }, [currentUser, isAdmin, loadTeamKpi]);

  const rows = report?.rows ?? [];
  const totals = report?.totals ?? EMPTY_TEAM_KPI_TOTALS;
  const visibleReportMatchesDate = report?.target_date === date;
  const noActivityCount = rows.filter((row) => row.total_completed_work === 0).length;
  const chartRows = useMemo(() => rows.slice(0, 12), [rows]);

  const handleDateChange = (nextDate: string) => {
    requestSequence.current += 1;
    setDate(nextDate);
    setReport(null);
    setError(null);
    setWarning(null);
    setLoading(true);
  };

  if (!isAuthLoading && currentUser && !isAdmin) {
    return (
      <section className="access-state" aria-labelledby="team-kpi-access-title">
        <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-[var(--radius-lg)] bg-[var(--status-danger-soft)] text-[var(--status-danger)]">
          <ShieldAlert size={22} />
        </span>
        <h1 id="team-kpi-access-title" className="text-lg font-semibold">Team KPI is restricted</h1>
        <p className="mx-auto mt-2 max-w-sm text-[13px] leading-5 text-[var(--text-muted)]">
          Only administrators can review confirmed work completed across the full team.
        </p>
      </section>
    );
  }

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Performance intelligence"
        icon={<BarChart3 size={18} />}
        title="Team performance"
        description="Review confirmed daily work across client calls, resolved queries, completed mappings, and completed tasks."
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Input
              type="date"
              value={date}
              onChange={(event) => handleDateChange(event.target.value)}
              leftIcon={<Calendar size={15} />}
              containerClassName="w-full sm:w-[190px]"
              aria-label="KPI date"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void loadTeamKpi(true)}
              disabled={loading || refreshing || !isAdmin}
              icon={<RefreshCw size={14} className={refreshing ? "animate-spin" : ""} />}
            >
              Refresh
            </Button>
          </div>
        }
      />

      <div className="segmented-control w-fit" aria-label="Performance report view">
        <button type="button" aria-pressed={activeTab === "Team"} onClick={() => setActiveTab("Team")}>
          <span className="flex items-center gap-2"><Users size={14} /> Team execution</span>
        </button>
        <button type="button" aria-pressed={activeTab === "Funnel"} onClick={() => setActiveTab("Funnel")}>
          <span className="flex items-center gap-2"><Layers size={14} /> Pipeline funnel</span>
        </button>
      </div>

      {activeTab === "Team" ? (
        <>
          {warning && (
            <div className="alert-panel alert-panel--warning" role="status">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p>{warning}</p>
                <p className="mt-1 text-[11px] opacity-80">Available confirmed metrics remain visible below.</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => void loadTeamKpi(true)}>Refresh</Button>
            </div>
          )}

          {error && (
            <div className="alert-panel alert-panel--danger" role="alert">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p>{error}</p>
                {report && <p className="mt-1 text-[11px] opacity-80">The last confirmed report remains visible below.</p>}
              </div>
              <Button size="sm" variant="outline" onClick={() => void loadTeamKpi(false)}>Retry</Button>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <MetricCard label="Team members" value={totals.team_members} icon={<Users size={17} />} tone="neutral" note="Active people included" />
            <MetricCard label="Total work" value={totals.total_completed_work} icon={<Activity size={17} />} tone="brand" note="All confirmed actions" />
            <MetricCard label="Calls" value={totals.calls_made} icon={<PhoneCall size={17} />} tone="info" note="Real call records" />
            <MetricCard label="Client queries" value={totals.queries_handled} icon={<MessageSquare size={17} />} tone="success" note="Resolved on this day" />
            <MetricCard label="Mappings" value={totals.mappings_completed} icon={<Link2 size={17} />} tone="warning" note="Completed mappings" />
            <MetricCard label="Tasks done" value={totals.tasks_completed} icon={<CheckCircle2 size={17} />} tone="success" note="Completed on this day" />
          </div>

          {loading || !visibleReportMatchesDate ? (
            <section className="surface-panel grid min-h-[360px] place-items-center">
              <p className="text-[13px] font-medium text-[var(--text-muted)]">Loading confirmed Team KPI data…</p>
            </section>
          ) : rows.length > 0 ? (
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
              <section className="surface-panel overflow-hidden" aria-labelledby="work-distribution-title">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--border-subtle)] p-5">
                  <div>
                    <p className="section-kicker">Execution distribution</p>
                    <h2 id="work-distribution-title" className="mt-1 section-title">Completed work by team member</h2>
                  </div>
                  <Chip variant="neutral" size="sm">Top {Math.min(chartRows.length, 12)} by volume</Chip>
                </div>
                {totals.total_completed_work > 0 ? (
                  <div className="h-[360px] p-4 sm:p-5">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartRows} layout="vertical" margin={{ top: 4, right: 12, left: 18, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" horizontal={false} />
                        <XAxis type="number" allowDecimals={false} stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} />
                        <YAxis type="category" dataKey="name" width={110} stroke="var(--text-muted)" fontSize={11} tickLine={false} axisLine={false} tick={{ width: 100 }} />
                        <Tooltip cursor={{ fill: "var(--surface-hover)" }} contentStyle={{ backgroundColor: "var(--surface-elevated)", borderColor: "var(--border-default)", borderRadius: "10px", color: "var(--text-primary)", fontSize: "12px", boxShadow: "var(--shadow-popover)" }} />
                        <Bar dataKey="calls_made" name="Calls" stackId="work" fill="var(--status-info)" radius={[4, 0, 0, 4]} />
                        <Bar dataKey="queries_handled" name="Client queries" stackId="work" fill="var(--status-success)" />
                        <Bar dataKey="mappings_completed" name="Mappings" stackId="work" fill="var(--status-warning)" />
                        <Bar dataKey="tasks_completed" name="Tasks done" stackId="work" fill="var(--brand-500)" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="p-5">
                    <EmptyState icon={<Activity size={21} />} title="No completed work on this day" description="All active team members are still listed below with zero values." />
                  </div>
                )}
              </section>

              <aside className="surface-panel overflow-hidden" aria-labelledby="activity-mix-title">
                <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-5">
                  <p className="section-kicker">Work mix</p>
                  <h2 id="activity-mix-title" className="mt-1 section-title">How the day was spent</h2>
                </div>
                <div className="space-y-3 p-4">
                  <WorkMixRow label="Calls" value={totals.calls_made} total={totals.total_completed_work} icon={<PhoneCall size={14} />} barClassName="bg-[var(--status-info)]" />
                  <WorkMixRow label="Client queries" value={totals.queries_handled} total={totals.total_completed_work} icon={<MessageSquare size={14} />} barClassName="bg-[var(--status-success)]" />
                  <WorkMixRow label="Mappings" value={totals.mappings_completed} total={totals.total_completed_work} icon={<Link2 size={14} />} barClassName="bg-[var(--status-warning)]" />
                  <WorkMixRow label="Tasks done" value={totals.tasks_completed} total={totals.total_completed_work} icon={<CheckCircle2 size={14} />} barClassName="bg-[var(--brand-500)]" />
                  <div className="rounded-[var(--radius-md)] bg-[var(--surface-secondary)] p-3 text-[11px] leading-5 text-[var(--text-muted)]">
                    {noActivityCount === 0 ? "Every active team member has recorded completed work." : `${noActivityCount} active team member${noActivityCount === 1 ? " has" : "s have"} no confirmed completed work for this date.`}
                  </div>
                </div>
              </aside>
            </div>
          ) : (
            <section className="surface-panel p-5">
              <EmptyState icon={<Users size={21} />} title="No active team members found" description="Check that active users and capability assignments exist in Supabase." />
            </section>
          )}

          <section className="data-table-shell" aria-labelledby="kpi-table-title">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-4">
              <div>
                <p className="section-kicker">Detailed scorecard</p>
                <h2 id="kpi-table-title" className="mt-1 section-title">Team KPI register</h2>
                {report && (
                  <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                    Last refreshed {formatActivityTime(report.generated_at)} IST
                    {refreshing ? " · Refreshing…" : ""}
                  </p>
                )}
              </div>
              <Chip variant="neutral" size="sm">{date}</Chip>
            </div>

            {!loading && rows.length === 0 ? (
              <div className="p-5">
                <EmptyState icon={<BarChart3 size={21} />} title="No KPI rows available" description={error || `No active team members are available for ${date}.`} />
              </div>
            ) : (
              <div className="overflow-x-auto" data-allow-overflow="horizontal">
                <table className="min-w-[940px]">
                  <thead>
                    <tr>
                      <th>Team member</th>
                      <th>Role</th>
                      <th>Total work</th>
                      <th>Calls</th>
                      <th>Client queries</th>
                      <th>Mappings</th>
                      <th>Tasks done</th>
                      <th>Last activity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row: TeamKpiRow) => (
                      <tr key={row.user_id}>
                        <td>
                          <p className="max-w-[220px] break-words font-semibold text-[var(--text-primary)]">{row.name}</p>
                        </td>
                        <td>
                          <span className="block max-w-[220px] truncate text-[12px] font-medium text-[var(--text-muted)]" title={row.role}>{row.role}</span>
                        </td>
                        <td className="font-semibold tabular-nums text-[var(--text-primary)]">{row.total_completed_work}</td>
                        <td className="font-semibold tabular-nums text-[var(--text-primary)]">{row.calls_made}</td>
                        <td className="font-semibold tabular-nums text-[var(--text-primary)]">{row.queries_handled}</td>
                        <td className="font-semibold tabular-nums text-[var(--text-primary)]">{row.mappings_completed}</td>
                        <td className="font-semibold tabular-nums text-[var(--text-primary)]">{row.tasks_completed}</td>
                        <td className="whitespace-nowrap text-[12px] text-[var(--text-muted)]">{formatActivityTime(row.latest_activity_time)}</td>
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
