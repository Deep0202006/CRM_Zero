"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  buildEmployeeTeamComparison,
  getContributionRows,
  partitionReconciles,
  TEAM_KPI_METRICS,
  type AnalyticsMetric,
  type TeamKpiAnalyticsRow,
  type TeamKpiMetricKey,
  type VisitActivityPoint,
  type VisitOutcomeSlice,
} from "@/lib/analytics/viewModels";
import { AnalyticsEmptyState } from "./AnalyticsPanel";
import { ChartContainer, ChartLegendContent, ChartTooltipContent } from "./Chart";
import { NumberTicker } from "./NumberTicker";

const tooltipStyle = {
  backgroundColor: "var(--surface-elevated)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-md)",
  boxShadow: "var(--shadow-popover)",
  color: "var(--text-primary)",
  fontSize: 12,
};

function DonutCenter({ value, label }: { value: number; label: string }) {
  return (
    <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
      <div className="max-w-28">
        <NumberTicker value={value} className="block text-[32px] font-semibold tracking-[-0.05em] text-[var(--text-primary)]" />
        <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">{label}</span>
      </div>
    </div>
  );
}

export function OutcomeDonut({ outcomes, total }: { outcomes: VisitOutcomeSlice[]; total: number }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const represented = outcomes.reduce((sum, item) => sum + item.value, 0);
  const chartOutcomes = outcomes.filter((item) => item.value > 0);
  if (represented !== total) {
    return <AnalyticsEmptyState title="Outcome composition unavailable" description={`The outcome segments represent ${represented} visits but the loaded page contains ${total}. The chart is hidden instead of showing a misleading composition.`} />;
  }
  if (!total) return <AnalyticsEmptyState title="No visits in this page" description="Outcome composition will appear when the current bounded page contains confirmed visits." />;

  if (chartOutcomes.length > 6) {
    return <ChartContainer config={{ value: { label: "Visits", color: "var(--viz-primary)" } }} className="h-[320px] w-full">
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 520, height: 320 }}>
        <BarChart data={chartOutcomes} layout="vertical" margin={{ top: 4, right: 28, bottom: 4, left: 18 }} accessibilityLayer>
          <CartesianGrid horizontal={false} stroke="var(--viz-grid)" strokeDasharray="4 5" />
          <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "var(--text-muted)", fontSize: 10 }} />
          <YAxis type="category" dataKey="label" width={118} tickLine={false} axisLine={false} tick={{ fill: "var(--text-secondary)", fontSize: 10 }} />
          <Tooltip cursor={{ fill: "var(--surface-hover)" }} content={<ChartTooltipContent />} />
          <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={24} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </ChartContainer>;
  }

  return (
    <div className="outcome-donut-layout grid gap-4">
      <div className="relative mx-auto h-[260px] w-full max-w-[340px] sm:h-[300px]" data-chart-height="stable">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 280 }}>
          <PieChart accessibilityLayer>
            <Pie
                data={chartOutcomes}
              dataKey="value"
              nameKey="label"
              innerRadius="62%"
              outerRadius="88%"
              paddingAngle={total > 1 ? 2 : 0}
              cornerRadius={6}
              stroke="var(--surface-primary)"
              strokeWidth={2}
              rootTabIndex={0}
              isAnimationActive={false}
              onMouseEnter={(_, index) => setActiveIndex(index)}
              onMouseLeave={() => setActiveIndex(null)}
            >
                  {chartOutcomes.map((item, index) => <Cell key={item.key} fill={item.color} opacity={activeIndex == null || activeIndex === index ? 1 : 0.35} />)}
            </Pie>
            <Tooltip formatter={(value, _name, item) => [`${Number(value).toLocaleString("en-IN")} (${Math.round((item.payload.share ?? 0) * 100)}%)`, item.payload.label]} contentStyle={tooltipStyle} />
          </PieChart>
        </ResponsiveContainer>
        <DonutCenter value={total} label="Loaded visits" />
      </div>
      <div className="max-h-[290px] space-y-1.5 overflow-y-auto pr-1" aria-label="Visit outcome legend">
        {outcomes.map((item) => (
          <div key={item.key} className="analytics-legend-row">
            <span className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: item.color }} aria-hidden="true" /><span className="truncate text-[12px] text-[var(--text-secondary)]">{item.label}</span></span>
            <span className="text-right text-[11px] tabular-nums text-[var(--text-muted)]"><strong className="text-[12px] text-[var(--text-primary)]">{item.value}</strong> · {Math.round(item.share * 100)}%</span>
          </div>
        ))}
      </div>
      <p className="sr-only">{outcomes.map((item) => `${item.label}: ${item.value} of ${total}.`).join(" ")}</p>
    </div>
  );
}

export function ActivityFlow({ points }: { points: VisitActivityPoint[] }) {
  const hasOther = points.some((point) => point.other > 0);
  if (!points.length) return <AnalyticsEmptyState title="No activity points" description="The current bounded page has no confirmed visit dates to plot." />;

  return (
    <div>
      <div className="h-[260px] w-full sm:h-[300px]" data-chart-height="stable">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 520, height: 280 }}>
          <BarChart data={points} margin={{ top: 12, right: 8, left: -18, bottom: 0 }} accessibilityLayer>
            <CartesianGrid vertical={false} stroke="var(--viz-grid)" strokeDasharray="4 5" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--text-muted)", fontSize: 10 }} minTickGap={18} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "var(--text-muted)", fontSize: 10 }} width={34} />
            <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "var(--text-primary)", fontWeight: 600 }} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 11, color: "var(--text-secondary)" }} />
            <Bar dataKey="retailer" name="Retailer visits" stackId="visits" fill="var(--viz-primary)" radius={[3, 3, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="distributor" name="Distributor visits" stackId="visits" fill="var(--viz-info)" isAnimationActive={false} />
            {hasOther && <Bar dataKey="other" name="Other / historical" stackId="visits" fill="var(--viz-muted)" isAnimationActive={false} />}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-[10px] leading-4 text-[var(--text-muted)]">Real IST check-in dates from the current bounded page; at most 31 daily points. No trend is inferred beyond loaded records.</p>
    </div>
  );
}

export function EmployeeContributionBars({ rows }: { rows: TeamKpiAnalyticsRow[] }) {
  const [metricKey, setMetricKey] = useState<TeamKpiMetricKey>("total_completed_work");
  const selectedMetric = TEAM_KPI_METRICS.find((metric) => metric.key === metricKey) ?? TEAM_KPI_METRICS[0];
  const contribution = getContributionRows(rows, metricKey);

  return (
    <div>
      <div className="segmented-control mb-4 flex w-full overflow-x-auto" aria-label="Contribution metric">
        {TEAM_KPI_METRICS.map((metric) => <button type="button" key={metric.key} aria-pressed={metric.key === metricKey} onClick={() => setMetricKey(metric.key)}>{metric.label}</button>)}
      </div>
      {contribution.total ? (
        <ChartContainer config={{ value: { label: selectedMetric.label, color: selectedMetric.color } }} className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 520, height: 300 }}>
            <BarChart data={contribution.rows.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))} layout="vertical" margin={{ top: 4, right: 28, bottom: 4, left: 18 }} accessibilityLayer>
              <CartesianGrid horizontal={false} stroke="var(--viz-grid)" strokeDasharray="4 5" />
              <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "var(--text-muted)", fontSize: 10 }} />
              <YAxis type="category" dataKey="label" width={108} tickLine={false} axisLine={false} tick={{ fill: "var(--text-secondary)", fontSize: 10 }} />
              <Tooltip cursor={{ fill: "var(--surface-hover)" }} content={<ChartTooltipContent />} />
              <Bar dataKey="value" fill={selectedMetric.color} radius={[0, 6, 6, 0]} maxBarSize={24} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </ChartContainer>
      ) : <AnalyticsEmptyState title={`No ${selectedMetric.label.toLowerCase()} recorded`} description="Every active employee remains represented with an exact zero value." />}
    </div>
  );
}

export function EmployeeTeamComparison({ rows }: { rows: TeamKpiAnalyticsRow[] }) {
  const [selectedUserId, setSelectedUserId] = useState(rows[0]?.user_id ?? "");
  const selected = rows.find((row) => row.user_id === selectedUserId) ?? rows[0];
  const profile = useMemo(() => buildEmployeeTeamComparison(rows, selected?.user_id ?? ""), [rows, selected?.user_id]);
  if (!selected) return <AnalyticsEmptyState title="No employee comparison" description="An active team member is required for an employee-to-team comparison." />;

  return (
    <div>
      <label className="mb-3 block text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--text-muted)]">Employee
        <select className="field-control mt-2 w-full" value={selected.user_id} onChange={(event) => setSelectedUserId(event.target.value)}>
          {rows.map((row) => <option key={row.user_id} value={row.user_id}>{row.name}</option>)}
        </select>
      </label>
      <ChartContainer config={{ employeeRaw: { label: selected.name, color: "var(--viz-primary)" }, teamRaw: { label: "Team average", color: "var(--viz-info)" } }} className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 520, height: 300 }}>
          <BarChart data={profile} layout="vertical" margin={{ top: 4, right: 20, bottom: 4, left: 18 }} accessibilityLayer>
            <CartesianGrid horizontal={false} stroke="var(--viz-grid)" strokeDasharray="4 5" />
            <XAxis type="number" tickLine={false} axisLine={false} tick={{ fill: "var(--text-muted)", fontSize: 10 }} />
            <YAxis type="category" dataKey="metric" width={104} tickLine={false} axisLine={false} tick={{ fill: "var(--text-secondary)", fontSize: 10 }} />
            <Tooltip cursor={{ fill: "var(--surface-hover)" }} content={<ChartTooltipContent valueFormatter={(value) => Number(value).toLocaleString("en-IN", { maximumFractionDigits: 1 })} />} />
            <Legend content={<ChartLegendContent />} />
            <Bar dataKey="employeeRaw" fill="var(--viz-primary)" radius={[0, 5, 5, 0]} maxBarSize={18} isAnimationActive={false} />
            <Bar dataKey="teamRaw" fill="var(--viz-info)" radius={[0, 5, 5, 0]} maxBarSize={18} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </ChartContainer>
      <p className="text-[10px] leading-4 text-[var(--text-muted)]">Grouped same-unit comparisons show exact employee and team-average values. This is not a score or rank.</p>
    </div>
  );
}

export function FieldMix({ metrics, total }: { metrics: AnalyticsMetric[]; total: number }) {
  if (!partitionReconciles(metrics, total)) return <AnalyticsEmptyState title="Field mix unavailable" description="The loaded segment buckets do not reconcile to the represented visit total, so the composition is hidden." />;
  if (!total) return <AnalyticsEmptyState title="No field mix" description="The current bounded page has no confirmed visits to classify." />;
  return <div className="space-y-4"><div className="flex h-5 w-full overflow-hidden rounded-full bg-[var(--viz-track)]" role="img" aria-label={`Field mix: ${metrics.map((metric) => `${metric.label} ${metric.value}`).join(", ")}`}>
    {metrics.filter((metric) => metric.value > 0).map((metric) => <span key={metric.key} style={{ width: `${metric.value / total * 100}%`, background: metric.color }} />)}
  </div><div className="grid gap-2 sm:grid-cols-3">{metrics.map((metric) => <div key={metric.key} className="flex items-center justify-between gap-3 text-[12px]"><span className="flex items-center gap-2 text-[var(--text-secondary)]"><span className="h-2.5 w-2.5 rounded-full" style={{ background: metric.color }} />{metric.label}</span><span className="font-semibold tabular-nums text-[var(--text-primary)]">{metric.value} <span className="font-normal text-[var(--text-muted)]">· {Math.round(metric.value / total * 100)}%</span></span></div>)}</div></div>;
}
