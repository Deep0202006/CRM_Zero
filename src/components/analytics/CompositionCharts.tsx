"use client";

import { useId, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  buildRelativeKpiProfile,
  getContributionRows,
  TEAM_KPI_METRICS,
  type AnalyticsMetric,
  type TeamKpiAnalyticsRow,
  type TeamKpiMetricKey,
  type VisitActivityPoint,
  type VisitOutcomeSlice,
} from "@/lib/analytics/viewModels";
import { AnalyticsEmptyState } from "./AnalyticsPanel";
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
  const gradientId = useId().replace(/:/g, "");
  const hasOther = points.some((point) => point.other > 0);
  if (!points.length) return <AnalyticsEmptyState title="No activity points" description="The current bounded page has no confirmed visit dates to plot." />;

  return (
    <div>
      <div className="h-[260px] w-full sm:h-[300px]" data-chart-height="stable">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 520, height: 280 }}>
          <AreaChart data={points} margin={{ top: 12, right: 8, left: -18, bottom: 0 }} accessibilityLayer>
            <defs>
              <linearGradient id={`${gradientId}-retailer`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--viz-primary)" stopOpacity={0.3} /><stop offset="95%" stopColor="var(--viz-primary)" stopOpacity={0.02} /></linearGradient>
                  <linearGradient id={`${gradientId}-distributor`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--viz-info)" stopOpacity={0.26} /><stop offset="95%" stopColor="var(--viz-info)" stopOpacity={0.02} /></linearGradient>
                  <linearGradient id={`${gradientId}-other`} x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--viz-muted)" stopOpacity={0.2} /><stop offset="95%" stopColor="var(--viz-muted)" stopOpacity={0.01} /></linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--viz-grid)" strokeDasharray="4 5" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: "var(--text-muted)", fontSize: 10 }} minTickGap={18} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "var(--text-muted)", fontSize: 10 }} width={34} />
            <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: "var(--text-primary)", fontWeight: 600 }} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 11, color: "var(--text-secondary)" }} />
            <Area type="monotone" dataKey="retailer" name="Retailer visits" stroke="var(--viz-primary)" fill={`url(#${gradientId}-retailer)`} strokeWidth={2.25} isAnimationActive={false} />
                <Area type="monotone" dataKey="distributor" name="Distributor visits" stroke="var(--viz-info)" fill={`url(#${gradientId}-distributor)`} strokeWidth={2.25} isAnimationActive={false} />
                {hasOther && <Area type="monotone" dataKey="other" name="Other / historical" stroke="var(--viz-muted)" fill={`url(#${gradientId}-other)`} strokeWidth={1.75} isAnimationActive={false} />}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <p className="mt-2 text-[10px] leading-4 text-[var(--text-muted)]">Real IST check-in dates from the current bounded page; at most 31 daily points. No trend is inferred beyond loaded records.</p>
    </div>
  );
}

export function ContributionRing({ rows }: { rows: TeamKpiAnalyticsRow[] }) {
  const [metricKey, setMetricKey] = useState<TeamKpiMetricKey>("calls_made");
  const selectedMetric = TEAM_KPI_METRICS.find((metric) => metric.key === metricKey) ?? TEAM_KPI_METRICS[0];
  const contribution = getContributionRows(rows, metricKey);
  const chartContribution = contribution.rows.filter((item) => item.value > 0);

  return (
    <div>
      <div className="segmented-control mb-4 flex w-full overflow-x-auto" aria-label="Contribution metric">
        {TEAM_KPI_METRICS.map((metric) => <button type="button" key={metric.key} aria-pressed={metric.key === metricKey} onClick={() => setMetricKey(metric.key)}>{metric.label}</button>)}
      </div>
      {contribution.total ? (
        <div className="contribution-ring-layout grid gap-4">
          <div className="relative mx-auto h-[220px] w-full max-w-[240px]" data-chart-height="stable">
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 220, height: 220 }}>
              <PieChart accessibilityLayer>
                <Pie data={chartContribution} dataKey="value" nameKey="label" innerRadius="64%" outerRadius="90%" paddingAngle={1.5} cornerRadius={5} stroke="var(--surface-primary)" strokeWidth={2} rootTabIndex={0} isAnimationActive={false}>
                  {chartContribution.map((item) => <Cell key={item.key} fill={item.color} />)}
                </Pie>
                <Tooltip formatter={(value, _name, item) => [`${Number(value).toLocaleString("en-IN")} (${Math.round((item.payload.share ?? 0) * 100)}%)`, item.payload.label]} contentStyle={tooltipStyle} />
              </PieChart>
            </ResponsiveContainer>
            <DonutCenter value={contribution.total} label={selectedMetric.label} />
          </div>
          <div className="max-h-[240px] space-y-1.5 overflow-y-auto pr-1">
            {contribution.rows.map((item) => <div key={item.key} className="analytics-legend-row"><span className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: item.color }} /><span className="truncate text-[12px] text-[var(--text-secondary)]">{item.label}</span></span><span className="text-[11px] tabular-nums text-[var(--text-muted)]"><strong className="text-[var(--text-primary)]">{item.value}</strong> · {Math.round(item.share * 100)}%</span></div>)}
          </div>
        </div>
      ) : <AnalyticsEmptyState title={`No ${selectedMetric.label.toLowerCase()} recorded`} description="Every active employee remains represented with an exact zero value." />}
    </div>
  );
}

export function KpiRadarProfile({ rows }: { rows: TeamKpiAnalyticsRow[] }) {
  const [selectedUserId, setSelectedUserId] = useState(rows[0]?.user_id ?? "");
  const selected = rows.find((row) => row.user_id === selectedUserId) ?? rows[0];
  const profile = useMemo(() => buildRelativeKpiProfile(rows, selected?.user_id ?? ""), [rows, selected?.user_id]);
  if (!selected) return <AnalyticsEmptyState title="No employee profile" description="An active team member is required for the relative KPI profile." />;

  return (
    <div>
      <label className="mb-3 block text-[11px] font-semibold uppercase tracking-[0.07em] text-[var(--text-muted)]">Employee
        <select className="field-control mt-2 w-full" value={selected.user_id} onChange={(event) => setSelectedUserId(event.target.value)}>
          {rows.map((row) => <option key={row.user_id} value={row.user_id}>{row.name}</option>)}
        </select>
      </label>
      <div className="h-[270px] w-full sm:h-[300px]" data-chart-height="stable">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 360, height: 280 }}>
          <RadarChart data={profile} outerRadius="72%" accessibilityLayer>
            <PolarGrid stroke="var(--viz-grid)" />
            <PolarAngleAxis dataKey="metric" tick={{ fill: "var(--text-muted)", fontSize: 10 }} />
            <Radar name={selected.name} dataKey="employee" stroke="var(--viz-primary)" fill="var(--viz-primary)" fillOpacity={0.24} strokeWidth={2} isAnimationActive={false} />
            <Radar name="Team average" dataKey="team" stroke="var(--viz-info)" fill="var(--viz-info)" fillOpacity={0.08} strokeWidth={1.5} isAnimationActive={false} />
            <Tooltip formatter={(_value, name, item) => {
              const raw = name === "Team average" ? item.payload.teamRaw : item.payload.employeeRaw;
              return [Number(raw).toLocaleString("en-IN", { maximumFractionDigits: 1 }), name];
            }} contentStyle={tooltipStyle} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-[10px] leading-4 text-[var(--text-muted)]">Display-only normalization: each dimension is scaled against the highest employee value for that same metric. Tooltips show raw authoritative values. This is not a score or rank.</p>
    </div>
  );
}

export function FieldMix({ metrics }: { metrics: AnalyticsMetric[] }) {
  const total = metrics.reduce((sum, metric) => sum + metric.value, 0);
  return (
    <div className="space-y-3">
      {metrics.map((metric) => {
        const share = total ? metric.value / total : 0;
        return <div key={metric.key}><div className="mb-1.5 flex items-center justify-between gap-3 text-[12px]"><span className="flex items-center gap-2 text-[var(--text-secondary)]"><span className="h-2.5 w-2.5 rounded-full" style={{ background: metric.color }} />{metric.label}</span><span className="font-semibold tabular-nums text-[var(--text-primary)]">{metric.value} <span className="font-normal text-[var(--text-muted)]">· {Math.round(share * 100)}%</span></span></div><div className="h-2 overflow-hidden rounded-full bg-[var(--viz-track)]"><div className="h-full rounded-full transition-[width] duration-[var(--motion-emphasis)]" style={{ width: `${share * 100}%`, background: metric.color }} /></div></div>;
      })}
      {!total && <AnalyticsEmptyState title="No field mix" description="The current bounded page has no confirmed visits to classify." />}
    </div>
  );
}
