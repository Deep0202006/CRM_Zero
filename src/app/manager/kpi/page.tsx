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
  AlertCircle,
  BarChart3,
  RefreshCw,
  ShieldAlert,
  Users,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/Tabs";
import { EmployeeDetailSheet } from "@/components/analytics/EmployeeDetailSheet";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";
import { AnalyticsSkeleton } from "@/components/analytics/AnalyticsPanel";
const FunnelTab = dynamic(() => import("./FunnelTab"), { ssr: false, loading: () => <AnalyticsSkeleton label="Loading pipeline funnel" /> });
const TeamHistory = dynamic(() => import("@/components/analytics/TeamHistory"), { ssr: false, loading: () => <AnalyticsSkeleton label="Loading retained history" /> });
const ManagementReview = dynamic(() => import("@/components/analytics/ManagementReview"), { ssr: false, loading: () => <AnalyticsSkeleton label="Loading current workload" /> });

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
  const [activeTab, setActiveTab] = useState<"Team" | "Funnel" | "Review">("Team");
  const [reportMode, setReportMode] = useState<"today" | "history">("today");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const employeeTrigger = useRef<HTMLButtonElement | null>(null);
  const [showComparison, setShowComparison] = useState(false);
  const [sort, setSort] = useState<"name" | "calls_made" | "tasks_completed" | "mappings_completed" | "queries_handled">("name");
  const requestSequence = useRef(0);
  const realtimeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadTeamKpi = useCallback(async (background = false) => {
    if (!currentUser || !isAdmin || activeTab !== "Team" || reportMode !== "today") return;

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
  }, [currentUser, isAdmin, todayDate, activeTab, reportMode]);

  useEffect(() => {
    if (isAuthLoading || !currentUser || !isAdmin) return;
    void loadTeamKpi(false);
    return () => { requestSequence.current += 1; };
  }, [currentUser, isAdmin, isAuthLoading, loadTeamKpi]);

  useEffect(() => {
    if (!currentUser || !isAdmin || !isSupabaseConfigured || activeTab !== "Team" || reportMode !== "today") return;

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
  }, [currentUser, isAdmin, loadTeamKpi, activeTab, reportMode]);

  const rows = [...(report?.rows ?? [])].sort((a, b) => (sort === "name" ? 0 : b[sort] - a[sort]) || a.name.localeCompare(b.name, "en-IN") || a.user_id.localeCompare(b.user_id));
  const totals = report?.totals ?? EMPTY_TEAM_KPI_TOTALS;
  const visibleReportMatchesDate = report?.target_date === todayDate;


  if (!isAuthLoading && !isAdmin) {
    return (
      <section className="access-state" aria-labelledby="team-kpi-access-title">
        <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-[var(--radius-lg)] bg-[var(--status-danger-soft)] text-[var(--status-danger)]">
          <ShieldAlert size={22} />
        </span>
        <h1 id="team-kpi-access-title" className="text-lg font-semibold">Team KPI is restricted</h1>
        <p className="mx-auto mt-2 max-w-sm text-[13px] leading-5 text-[var(--text-secondary)]">
          Only administrators can review confirmed work completed across the full team.
        </p>
      </section>
    );
  }

  return (
    <div className="app-page crm-workspace">
      <header className="workspace-heading"><div><h1>Team KPI</h1><p>{activeTab === "Review" ? "Admin current workload · Tasks and allocated targets kept separate" : activeTab === "Funnel" ? "Admin Pipeline inspection · Existing authorized report" : reportMode === "history" ? "Retained record history · Complete activity coverage unknown" : `Today · ${todayDate} · Asia/Kolkata`}</p></div>{reportMode === "today" && activeTab === "Team" && <Button size="sm" variant="outline" onClick={() => void loadTeamKpi(true)} disabled={loading || refreshing || !isAdmin} icon={<RefreshCw size={14} />}>Refresh</Button>}</header>
      <Tabs value={activeTab !== "Team" ? activeTab : reportMode} onValueChange={(value) => { setActiveTab(value === "Funnel" || value === "Review" ? value : "Team"); if (value !== "Funnel" && value !== "Review") setReportMode(value as "today" | "history"); setSelectedId(null); }} activationMode="manual">
        <TabsList aria-label="Performance report view" className="grid w-full max-w-full grid-cols-2 sm:inline-flex sm:w-fit"><TabsTrigger value="today">Today</TabsTrigger><TabsTrigger value="history">Employee history</TabsTrigger><TabsTrigger value="Funnel">Pipeline inspection</TabsTrigger><TabsTrigger value="Review">Review</TabsTrigger></TabsList>
        <TabsContent value="Review">{activeTab === "Review" && isAdmin && currentUser && <ManagementReview key={currentUser.user_id} />}</TabsContent>
        <TabsContent value="history">{reportMode === "history" && activeTab === "Team" && isAdmin && currentUser && <TeamHistory key={currentUser.user_id} />}</TabsContent>
        <TabsContent value="today" className="space-y-4">
          {warning && (
            <div className="alert-panel alert-panel--warning" role="status">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p>{warning}</p>
                <p className="mt-1 text-xs opacity-80">Available confirmed metrics remain visible below.</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => void loadTeamKpi(true)}>Refresh</Button>
            </div>
          )}

          {error && (
            <div className="alert-panel alert-panel--danger" role="alert">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p>{error}</p>
                {report && <p className="mt-1 text-xs opacity-80">The last confirmed report remains visible below.</p>}
              </div>
              <Button size="sm" variant="outline" onClick={() => void loadTeamKpi(false)}>Retry</Button>
            </div>
          )}

          <dl className="workspace-counts" aria-label="Today confirmed work">
            {[["Calls today", totals.calls_made], ["Tasks completed · includes targets", totals.tasks_completed], ["Mappings completed", totals.mappings_completed], ["Queries resolved", totals.queries_handled]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{report ? Number(value).toLocaleString("en-IN") : "—"}</dd></div>)}
          </dl>

          {loading && <p role="status">Loading confirmed Team KPI data…</p>}
          {!visibleReportMatchesDate && report && <p role="status">This retained report is from {report.target_date}; refresh for Today.</p>}
          <div className="workspace-columns">
          <section className="data-table-shell" aria-labelledby="kpi-table-title">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-2">
              <div>

                <h2 id="kpi-table-title" data-workspace-register tabIndex={-1} className="mt-1 section-title">Team KPI register</h2>
                {report && (
                  <p className="mt-1 text-xs text-[var(--text-secondary)]">
                    Last refreshed {formatActivityTime(report.generated_at)} IST
                    {refreshing ? " · Refreshing…" : ""}
                  </p>
                )}
              </div>
              <label className="flex items-center gap-2 text-sm">Sort by
                <select className="field-control" value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
                  <option value="name">Name (A–Z)</option><option value="calls_made">Calls today (highest first)</option><option value="tasks_completed">Tasks completed (highest first)</option><option value="mappings_completed">Mappings completed (highest first)</option><option value="queries_handled">Queries resolved (highest first)</option>
                </select>
              </label>
            </div>

            {!loading && rows.length === 0 ? (
              <div className="p-5">
                <EmptyState icon={<BarChart3 size={21} />} title="No KPI rows available" description={error || `No active team members are available for ${todayDate}.`} />
              </div>
            ) : (
              <div className="max-h-[640px] overflow-auto" role="region" aria-label="Team KPI register" tabIndex={0} data-allow-overflow="horizontal">
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
                          <button type="button" className="min-h-11 max-w-[220px] whitespace-normal break-words text-left font-semibold text-[var(--brand-700)] dark:text-[var(--brand-500)] underline underline-offset-4" onClick={(event) => { employeeTrigger.current = event.currentTarget; setSelectedId(row.user_id); }}>{row.name}</button>
                        </td>
                        <td>
                          <span className="block max-w-[220px] whitespace-normal break-words text-[12px] font-medium leading-5 text-[var(--text-secondary)]">{row.role}</span>
                        </td>
                        <td><Chip variant={row.attendance_status === "Present" ? "success" : "danger"} size="sm" dot>{row.attendance_status}</Chip></td>
                        <td className="font-semibold tabular-nums text-[var(--text-primary)]">{row.total_completed_work}</td>
                        <td className="font-semibold tabular-nums text-[var(--text-primary)]">{row.calls_made}</td>
                        <td className="font-semibold tabular-nums text-[var(--text-primary)]">{row.followup_calls}</td>
                        <td className="font-semibold tabular-nums text-[var(--text-primary)]">{row.queries_handled}</td>
                        <td className="font-semibold tabular-nums text-[var(--text-primary)]">{row.mappings_completed}</td>
                        <td className="font-semibold tabular-nums text-[var(--text-primary)]">{row.tasks_completed}</td>
                        <td className="whitespace-nowrap text-[12px] text-[var(--text-secondary)]">{formatActivityTime(row.latest_activity_time)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          {report && <EmployeeDetailSheet report={report} selectedId={selectedId} onClose={() => setSelectedId(null)} returnFocus={employeeTrigger} refreshing={refreshing} error={error} />}
          </div>
        <details className="workspace-disclosure"><summary>Additional daily counts · scope and deduplication</summary>          <dl className="flex flex-wrap gap-x-6 gap-y-3 text-sm">
            <div><dt className="text-[var(--text-secondary)]">Team members</dt><dd className="font-semibold">{report ? totals.team_members.toLocaleString("en-IN") : "—"}</dd></div>
            <div><dt className="text-[var(--text-secondary)]">Follow-up calls · subset of Calls</dt><dd className="font-semibold">{report ? totals.followup_calls.toLocaleString("en-IN") : "—"}</dd></div>
            <div><dt className="text-[var(--text-secondary)]">Unique completed work · linked call/task counted once</dt><dd className="font-semibold">{report ? totals.total_completed_work.toLocaleString("en-IN") : "—"}</dd></div>
          </dl>
</details>
        <Button variant="outline" aria-expanded={showComparison} onClick={() => setShowComparison((value) => !value)}>{showComparison ? "Hide" : "Show"} employee reference</Button>
        {showComparison && report && <TeamKpiIntelligence rows={report.rows} comparison comparisonAvailable={!warning && !error && visibleReportMatchesDate} />}
        </TabsContent>
        <TabsContent value="Funnel">{activeTab === "Funnel" && isAdmin && currentUser && <FunnelTab key={currentUser.user_id} />}</TabsContent>
      </Tabs>
    </div>
  );
}
