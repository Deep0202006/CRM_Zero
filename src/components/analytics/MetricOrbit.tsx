"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AnalyticsMetric } from "@/lib/analytics/viewModels";
import { ChartContainer, ChartTooltipContent, type ChartConfig } from "./Chart";

export function MetricOrbit({ metrics, centerLabel }: { metrics: AnalyticsMetric[]; centerLabel: string }) {
  const data = metrics.map((metric) => ({ signal: metric.label, value: metric.value, fill: metric.color }));
  const config: ChartConfig = { value: { label: centerLabel, color: "var(--viz-primary)" } };
  return <ChartContainer config={config} className="h-[260px] w-full" >
    <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 520, height: 260 }}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 28, bottom: 4, left: 8 }} accessibilityLayer>
        <CartesianGrid horizontal={false} stroke="var(--viz-grid)" strokeDasharray="4 5" />
        <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "var(--text-muted)", fontSize: 10 }} />
        <YAxis type="category" dataKey="signal" width={118} tickLine={false} axisLine={false} tick={{ fill: "var(--text-secondary)", fontSize: 11 }} />
        <Tooltip cursor={{ fill: "var(--surface-hover)" }} content={<ChartTooltipContent />} />
        <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={28} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
    <p className="sr-only">Independent work signals. {metrics.map((metric) => `${metric.label}: ${metric.value}.`).join(" ")}</p>
  </ChartContainer>;
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
