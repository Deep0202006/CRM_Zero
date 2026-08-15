"use client";

import { PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer, Tooltip } from "recharts";
import type { AnalyticsMetric } from "@/lib/analytics/viewModels";
import { metricTotal } from "@/lib/analytics/viewModels";
import { NumberTicker } from "./NumberTicker";

const tooltipStyle = {
  backgroundColor: "var(--surface-elevated)",
  border: "1px solid var(--border-default)",
  borderRadius: "var(--radius-md)",
  boxShadow: "var(--shadow-popover)",
  color: "var(--text-primary)",
  fontSize: 12,
};

export function MetricOrbit({ metrics, centerLabel }: { metrics: AnalyticsMetric[]; centerLabel: string }) {
  const total = metricTotal(metrics);
  const domainMax = Math.max(1, ...metrics.map((metric) => metric.value));
  const chartData = metrics.map((metric) => ({ ...metric, fill: metric.color }));

  return (
    <div className="metric-orbit-layout grid gap-5">
      <div className="relative mx-auto h-[260px] w-full max-w-[330px] sm:h-[290px]" data-chart-height="stable">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 280 }}>
          <RadialBarChart
            data={chartData}
            innerRadius="30%"
            outerRadius="94%"
            startAngle={90}
            endAngle={-270}
            barSize={11}
            accessibilityLayer
          >
            <PolarAngleAxis type="number" domain={[0, domainMax]} tick={false} axisLine={false} />
            <RadialBar dataKey="value" name="Count" background={{ fill: "var(--viz-track)" }} cornerRadius={8} isAnimationActive={false} />
            <Tooltip
              formatter={(value, _name, item) => [Number(value).toLocaleString("en-IN"), item.payload.label]}
              contentStyle={tooltipStyle}
              cursor={false}
            />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
          <div className="max-w-24">
            <NumberTicker value={total} className="block text-[34px] font-semibold tracking-[-0.055em] text-[var(--text-primary)]" />
            <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">{centerLabel}</span>
          </div>
        </div>
      </div>

      <div className="space-y-2" aria-label={`${centerLabel}: ${total}`}>
        {metrics.map((metric) => (
          <div key={metric.key} className="analytics-legend-row">
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: metric.color }} aria-hidden="true" />
              <span className="truncate text-[12px] font-medium text-[var(--text-secondary)]">{metric.label}</span>
            </span>
            <span className="font-semibold tabular-nums text-[var(--text-primary)]">{metric.value.toLocaleString("en-IN")}</span>
          </div>
        ))}
        <p className="pt-2 text-[10px] leading-4 text-[var(--text-muted)]">Ring length compares raw counts on one common count scale. It does not represent progress toward a target.</p>
      </div>
      <p className="sr-only">{metrics.map((metric) => `${metric.label}: ${metric.value}.`).join(" ")}</p>
    </div>
  );
}

export function UrgencyTracker({ items }: { items: AnalyticsMetric[] }) {
  return (
    <div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="list" aria-label="Task urgency">
        {items.map((item) => (
          <div key={item.key} role="listitem" className="group relative overflow-hidden rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-3">
            <span className="absolute inset-x-0 top-0 h-1" style={{ background: item.color }} aria-hidden="true" />
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.075em] text-[var(--text-muted)]">{item.label}</p>
            <p className="mt-2 text-[24px] font-semibold tracking-[-0.04em] text-[var(--text-primary)]">{item.value.toLocaleString("en-IN")}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
