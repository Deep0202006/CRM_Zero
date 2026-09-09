"use client";

import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { useId } from "react";
import type { AnalyticsMetric } from "@/lib/analytics/viewModels";
import { ChartContainer, ChartTooltipContent, type ChartConfig } from "./Chart";

export function IndependentMetricBars({ metrics, valueLabel }: { metrics: AnalyticsMetric[]; valueLabel: string }) {
  const summaryId = useId();
  const data = metrics.map((metric) => ({ signal: metric.label, value: metric.value, fill: metric.color }));
  const config: ChartConfig = { value: { label: valueLabel, color: "var(--viz-primary)" } };
  return <><ChartContainer aria-describedby={summaryId} config={config} className="h-[260px] w-full"  initialDimension={{ width: 520, height: 260 }}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 28, bottom: 4, left: 8 }} accessibilityLayer>
        <CartesianGrid horizontal={false} stroke="var(--viz-grid)" strokeDasharray="4 5" />
        <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "var(--text-muted)", fontSize: 10 }} />
        <YAxis type="category" dataKey="signal" width={118} tickLine={false} axisLine={false} tick={{ fill: "var(--text-secondary)", fontSize: 11 }} />
        <Tooltip cursor={{ fill: "var(--surface-hover)" }} content={<ChartTooltipContent />} />
        <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={28} isAnimationActive={false} />
      </BarChart>
  </ChartContainer>
    <p id={summaryId} className="sr-only">Independent work signals. {metrics.map((metric) => `${metric.label}: ${metric.value}.`).join(" ")}</p>
  </>;
}

export function UrgencyTracker({ items }: { items: AnalyticsMetric[] }) {
  return <IndependentMetricBars metrics={items} valueLabel="Tasks" />;
}
