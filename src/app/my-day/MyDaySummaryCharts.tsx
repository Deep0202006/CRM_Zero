"use client";

import { AnalyticsBoundary, AnalyticsPanel } from "@/components/analytics/AnalyticsPanel";
import type { AnalyticsMetric } from "@/lib/analytics/viewModels";

export default function MyDaySummaryCharts({ focus, urgency }: { focus: AnalyticsMetric[]; urgency: AnalyticsMetric[] }) {
  const maximum = Math.max(1, ...focus.map((item) => item.value));
  return <AnalyticsBoundary><section className="analytics-shell" aria-label="Daily command center visual intelligence">
    <AnalyticsPanel title="Today’s focus orbit" description="Already-loaded work signals, each shown independently. No combined work total or target attainment is implied." labelledBy="my-day-focus-orbit">
      <div className="grid gap-4 sm:grid-cols-2 sm:items-center">
        <svg viewBox="0 0 280 280" className="mx-auto w-full max-w-[280px]" role="img" aria-label={focus.map((item) => `${item.label}: ${item.value}`).join(". ")}>
          {focus.map((item, index) => {
            const radius = 122 - index * 17, circumference = 2 * Math.PI * radius;
            return <g key={item.key} transform="rotate(-90 140 140)"><circle cx="140" cy="140" r={radius} fill="none" stroke="var(--viz-track)" strokeWidth="10" /><circle cx="140" cy="140" r={radius} fill="none" stroke={item.color} strokeWidth="10" strokeDasharray={`${circumference * item.value / maximum} ${circumference}`} /></g>;
          })}
          <text x="140" y="137" textAnchor="middle" fill="var(--text-primary)" fontSize="13">Independent</text><text x="140" y="155" textAnchor="middle" fill="var(--text-muted)" fontSize="12">work signals</text>
        </svg>
        <dl className="space-y-3">{focus.map((item) => <div key={item.key} className="flex justify-between gap-3 text-sm"><dt><span className="mr-2 inline-block size-2 rounded-full" style={{ background: item.color }} />{item.label}</dt><dd className="font-semibold tabular-nums">{item.value.toLocaleString("en-IN")}</dd></div>)}</dl>
      </div>
      <p className="mt-3 text-xs text-[var(--text-muted)]">Ring length uses a common count scale (0–{maximum}); signals can overlap and must not be added.</p>
    </AnalyticsPanel>
    <AnalyticsPanel title="Urgency ribbon" description="Your active, incomplete local tasks by actual due date in Asia/Kolkata. Missed status is separate from date-based overdue work." labelledBy="my-day-urgency-ribbon">
      <dl className="grid grid-cols-2 gap-3">{urgency.map((item) => <div key={item.key} className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] border-t-4 bg-[var(--surface-secondary)] p-4" style={{ borderTopColor: item.color }}><dt className="text-sm text-[var(--text-secondary)]">{item.label}</dt><dd className="mt-2 text-3xl font-semibold tabular-nums">{item.value.toLocaleString("en-IN")}</dd></div>)}</dl>
    </AnalyticsPanel>
  </section></AnalyticsBoundary>;
}
