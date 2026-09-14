"use client";

import { useState } from "react";
import { Cell, Legend, Pie, PieChart, PolarAngleAxis, PolarGrid, PolarRadiusAxis, Radar, RadarChart, RadialBar, RadialBarChart, ResponsiveContainer, Tooltip } from "recharts";
import { AnalyticsBoundary, AnalyticsEmptyState, AnalyticsPanel } from "@/components/analytics/AnalyticsPanel";
import { buildEmployeeTeamComparison, getContributionRows, TEAM_KPI_METRICS, type TeamKpiAnalyticsRow, type TeamKpiMetricKey } from "@/lib/analytics/viewModels";

const tooltipStyle = { backgroundColor: "var(--surface-elevated)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-md)", color: "var(--text-primary)", fontSize: 12 };

export default function TeamSummaryCharts({ rows, comparisonAvailable }: { rows: TeamKpiAnalyticsRow[]; comparisonAvailable: boolean }) {
  const [metricKey, setMetricKey] = useState<TeamKpiMetricKey>("calls_made");
  const [employeeId, setEmployeeId] = useState("");
  const selected = rows.find((row) => row.user_id === employeeId) ?? rows[0];
  const metric = TEAM_KPI_METRICS.find((item) => item.key === metricKey)!;
  const contribution = getContributionRows(rows, metricKey);
  const pulse = TEAM_KPI_METRICS.filter((item) => ["calls_made", "tasks_completed", "mappings_completed", "queries_handled"].includes(item.key)).map((item) => ({ ...item, value: getContributionRows(rows, item.key).total, fill: item.color }));
  const maximum = Math.max(1, ...pulse.map((item) => item.value));
  const profile = buildEmployeeTeamComparison(rows, selected?.user_id ?? "").map((point, index) => {
    const maximum = Math.max(1, ...rows.map((row) => row[TEAM_KPI_METRICS[index].key] ?? 0));
    return { ...point, employee: point.employeeRaw / maximum * 100, team: point.teamRaw / maximum * 100 };
  });
  return <AnalyticsBoundary><section className="analytics-shell" aria-label="Team intelligence visualizations">
    <AnalyticsPanel title="Confirmed work pulse" description="Current confirmed report · Independent work types, not a combined total or historical trend." labelledBy="team-work-pulse" className="xl:col-span-2">
      <div className="grid gap-4 sm:grid-cols-2 sm:items-center">
        <div className="relative h-[270px]">
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 280 }}><RadialBarChart data={pulse} innerRadius="35%" outerRadius="95%" startAngle={90} endAngle={-270} barSize={12} accessibilityLayer><PolarAngleAxis type="number" domain={[0, maximum]} tick={false} axisLine={false} /><RadialBar dataKey="value" background={{ fill: "var(--viz-track)" }} isAnimationActive={false} /><Tooltip formatter={(value, _name, item) => [Number(value).toLocaleString("en-IN"), item.payload.label]} contentStyle={tooltipStyle} /></RadialBarChart></ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center text-sm text-[var(--text-secondary)]"><span>Independent<br />work counts</span></div>
        </div>
        <div><dl className="space-y-3">{pulse.map((item) => <div key={item.key} className="flex justify-between gap-3 text-sm"><dt><span className="mr-2 inline-block size-2 rounded-full" style={{ background: item.color }} />{item.label}</dt><dd className="font-semibold tabular-nums">{item.value}</dd></div>)}</dl><p className="mt-4 text-xs text-[var(--text-muted)]">Common count scale: 0–{maximum}. Work types may overlap; ring lengths are not target progress.</p></div>
      </div>
    </AnalyticsPanel>
    <AnalyticsPanel title="Contribution ring" description="Each employee contributes to one selected metric from this report’s active-team cohort." labelledBy="team-contribution-ring">
      <label className="block text-sm">Contribution metric<select className="field-control mt-2 w-full" value={metricKey} onChange={(event) => setMetricKey(event.target.value as TeamKpiMetricKey)}>{TEAM_KPI_METRICS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
      {contribution.total > 0 ? <div className="relative h-[250px]"><ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 280 }}><PieChart accessibilityLayer><Pie data={contribution.rows.filter((row) => row.value > 0)} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="88%" stroke="var(--surface-primary)" isAnimationActive={false}>{contribution.rows.filter((row) => row.value > 0).map((row) => <Cell key={row.key} fill={row.color} />)}</Pie><Tooltip formatter={(value, _name, item) => [`${value} of ${contribution.total}`, item.payload.label]} contentStyle={tooltipStyle} /></PieChart></ResponsiveContainer><div className="pointer-events-none absolute inset-0 grid place-items-center text-center"><div><strong className="block text-3xl tabular-nums">{contribution.total}</strong><span className="text-xs">{metric.label}</span></div></div></div> : <AnalyticsEmptyState title={`No ${metric.label.toLowerCase()} recorded`} description="Zero total: no contribution shares are implied." />}
      <ul className="max-h-48 space-y-2 overflow-auto text-sm" aria-label="Exact employee contribution">{contribution.rows.map((row) => <li key={row.key} className="flex justify-between gap-3"><span>{row.label}</span><span className="tabular-nums">{row.value} of {contribution.total}</span></li>)}</ul>
    </AnalyticsPanel>
    <AnalyticsPanel title="Employee shape vs team" description={`Descriptive peer context · ${rows.length} active team members in the current report, including the selected employee. Not a score or rank.`} labelledBy="team-radar-profile">
      {!comparisonAvailable ? <AnalyticsEmptyState title="Peer comparison unavailable" description="A fresh, complete current report is required. Retained work counts remain visible." /> : !selected ? <AnalyticsEmptyState title="No employee profile" description="An active team member is required." /> : <>
        <label className="block text-sm">Radar employee<select className="field-control mt-2 w-full" value={selected.user_id} onChange={(event) => setEmployeeId(event.target.value)}>{rows.map((row) => <option key={row.user_id} value={row.user_id}>{row.name}</option>)}</select></label>
        <div className="h-[300px]"><ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 280 }}><RadarChart data={profile} outerRadius="62%" accessibilityLayer><PolarGrid stroke="var(--viz-grid)" /><PolarAngleAxis dataKey="metric" tick={{ fill: "var(--text-muted)", fontSize: 10 }} /><PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} /><Radar name={selected.name} dataKey="employee" stroke="var(--viz-primary)" fill="var(--viz-primary)" fillOpacity={0.24} isAnimationActive={false} /><Radar name="Team average" dataKey="team" stroke="var(--viz-info)" fill="var(--viz-info)" fillOpacity={0.08} isAnimationActive={false} /><Tooltip formatter={(_value, name, item) => [String(item.dataKey === "team" ? item.payload.teamRaw : item.payload.employeeRaw), name]} contentStyle={tooltipStyle} /><Legend /></RadarChart></ResponsiveContainer></div>
        <p className="text-xs text-[var(--text-muted)]">Each axis scales independently from 0 to that metric’s highest employee count (100). All-zero axes stay zero. Tooltips and the table show raw counts, not normalized scores.</p>
        <table className="mt-3 w-full text-xs" aria-label="Raw radar values"><thead><tr><th scope="col">Metric</th><th scope="col">Employee</th><th scope="col">Team average</th></tr></thead><tbody>{profile.map((point) => <tr key={point.metric}><th scope="row" className="text-left font-normal">{point.metric}</th><td className="text-center tabular-nums">{point.employeeRaw}</td><td className="text-center tabular-nums">{point.teamRaw}</td></tr>)}</tbody></table>
      </>}
    </AnalyticsPanel>
  </section></AnalyticsBoundary>;
}
