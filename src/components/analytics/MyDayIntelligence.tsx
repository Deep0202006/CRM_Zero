"use client";

import type { AnalyticsMetric } from "@/lib/analytics/viewModels";
import { AnalyticsBoundary, AnalyticsPanel } from "./AnalyticsPanel";
import { MetricOrbit, UrgencyTracker } from "./MetricOrbit";

export default function MyDayIntelligence({ focus, urgency }: { focus: AnalyticsMetric[]; urgency: AnalyticsMetric[] }) {
  return (
    <AnalyticsBoundary>
      <section className="analytics-shell" aria-label="Daily command center visual intelligence">
        <AnalyticsPanel
          eyebrow="Daily command center"
          title="Today’s focus orbit"
          description="One visual read of the work and confirmed activity already loaded on this page. Exact values remain visible beside every ring."
          labelledBy="my-day-focus-orbit"
        >
          <MetricOrbit metrics={focus} centerLabel="Focus signals" />
        </AnalyticsPanel>
        <AnalyticsPanel
          eyebrow="Task urgency"
          title="Urgency ribbon"
          description="Missed, due-today, and scheduled-later task buckets from the existing My Day task model."
          labelledBy="my-day-urgency-ribbon"
        >
          <UrgencyTracker items={urgency} />
        </AnalyticsPanel>
      </section>
    </AnalyticsBoundary>
  );
}
