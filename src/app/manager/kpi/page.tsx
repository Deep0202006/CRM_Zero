"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
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
  Activity,
  AlertCircle,
  BarChart3,
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
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { AnalyticsSkeleton } from "@/components/analytics/AnalyticsPanel";
import { NumberTicker } from "@/components/analytics/NumberTicker";
import type { AnalyticsMetric } from "@/lib/analytics/viewModels";

const TeamKpiIntelligence = dynamic(() => import("@/components/analytics/TeamKpiIntelligence"), {
  ssr: false,
  loading: () => <AnalyticsSkeleton label="Loading team intelligence" />,
});

const REALTIME_TABLES = [
  "call_logs",
  "tasks",
  "task_status_history",
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

export default function ManagerKpiPage() {
  const { currentUser, isAdmin, isLoading: isAuthLoading } = useAuth();
  const [report, setReport] = useState<TeamKpiResponse | null>(null);
  const todayDate = getCurrentISTDate();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"Team" | "Funnel">("Team");
  const requestSequence = useRef(0);
  const realtimeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadTeamKpi = useCallback(async (background = false) => {
    if (!currentUser || !isAdmin) return;

    const requestId = ++requestSequence.current;
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

      const response = await fetch("/api/team-kpi", {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
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
      if (parsed.target_date !== todayDate) {
        throw new Error("Team KPI returned data for a different business date.");
      }

      setReport(parsed);
      setError(null);
      setWarning(
        parsed.warnings.length > 0
          ? `Some KPI sources need attention: ${parsed.warnings.map((item) => item.message).join(" ")}`
          : null,
      );
    } catch (caughtError: unknown) {
      if (requestId !== requestSequence.current) return;
      console.error("Team KPI refresh failed", caughtError);
      setError(getTeamKpiErrorMessage(caughtError));
    } finally {
      if (requestId === requestSequence.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [currentUser, isAdmin, todayDate]);

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
      }, 350);
    };

    let channel = supabase.channel(`team-kpi-${currentUser.user_id}`);
    for (const table of REALTIME_TABLES) {
      channel = channel
        .on("postgres_changes", { event: "INSERT", schema: "public", table }, scheduleRefresh)
        .on("postgres_changes", { event: "UPDATE", schema: "public", table }, scheduleRefresh);
    }
    channel.subscribe();

    return () => {
      if (realtimeTimer.current) clearTimeout(realtimeTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [currentUser, isAdmin, loadTeamKpi]);

  const rows = report?.rows ?? [];
  const totals = report?.totals ?? EMPTY_TEAM_KPI_TOTALS;
  const visibleReportMatchesDate = report?.target_date === todayDate;
  const pulseMetrics: AnalyticsMetric[] = [
    { key: "calls", label: "Calls", value: totals.calls_made, color: "var(--viz-info)" },
    { key: "queries", label: "Client queries", value: totals.queries_handled, color: "var(--viz-success)" },
    { key: "mappings", label: "Mappings", value: totals.mappings_completed, color: "var(--viz-warning)" },
    { key: "tasks", label: "Tasks done", value: totals.tasks_completed, color: "var(--viz-primary)" },
  ];

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
        title="Team Intelligence"
        description="Review confirmed daily work across client calls, resolved queries, completed mappings, and completed tasks."
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
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

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
            <MetricCard label="Team members" value={report ? <NumberTicker value={totals.team_members} /> : "—"} icon={<Users size={17} />} tone="neutral" note="Active people included" />
            <MetricCard label="Unique completed work" value={report ? <NumberTicker value={totals.total_completed_work} /> : "—"} icon={<Activity size={17} />} tone="brand" note="Linked follow-up call and task count once here" />
            <MetricCard label="Calls today" value={report ? <NumberTicker value={totals.calls_made} /> : "—"} icon={<PhoneCall size={17} />} tone="info" note="Real call records" />
            <MetricCard label="Follow-up calls" value={report ? <NumberTicker value={totals.followup_calls} /> : "—"} icon={<PhoneCall size={17} />} tone="info" note="Included in Calls today" />
            <MetricCard label="Client queries" value={report ? <NumberTicker value={totals.queries_handled} /> : "—"} icon={<MessageSquare size={17} />} tone="success" note="Resolved today" />
            <MetricCard label="Mappings" value={report ? <NumberTicker value={totals.mappings_completed} /> : "—"} icon={<Link2 size={17} />} tone="warning" note="Completed today" />
            <MetricCard label="Tasks done" value={report ? <NumberTicker value={totals.tasks_completed} /> : "—"} icon={<CheckCircle2 size={17} />} tone="success" note="Tasks and allocated targets" />
          </div>

          {loading || !visibleReportMatchesDate ? (
            <section className="surface-panel grid min-h-[360px] place-items-center">
              <p className="text-[13px] font-medium text-[var(--text-muted)]">Loading confirmed Team KPI data…</p>
            </section>
          ) : rows.length > 0 ? (
            <TeamKpiIntelligence rows={rows} pulse={pulseMetrics} />
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
              <Chip variant="neutral" size="sm">{todayDate} · Asia/Kolkata</Chip>
            </div>

            {!loading && rows.length === 0 ? (
              <div className="p-5">
                <EmptyState icon={<BarChart3 size={21} />} title="No KPI rows available" description={error || `No active team members are available for ${todayDate}.`} />
              </div>
            ) : (
              <div className="overflow-x-auto" data-allow-overflow="horizontal">
                <table className="min-w-[940px]">
                  <thead>
                    <tr>
                      <th>Team member</th>
                      <th>Role</th>
                      <th>Attendance</th>
                      <th>Unique completed work</th>
                      <th>Calls today</th>
                      <th>Follow-up calls</th>
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
                          <span className="block max-w-[220px] whitespace-normal break-words text-[12px] font-medium leading-5 text-[var(--text-muted)]">{row.role}</span>
                        </td>
                        <td><Chip variant={row.attendance_status === "Present" ? "success" : "danger"} size="sm" dot>{row.attendance_status}</Chip></td>
                        <td className="font-semibold tabular-nums text-[var(--text-primary)]">{row.total_completed_work}</td>
                        <td className="font-semibold tabular-nums text-[var(--text-primary)]">{row.calls_made}</td>
                        <td className="font-semibold tabular-nums text-[var(--text-primary)]">{row.followup_calls}</td>
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
