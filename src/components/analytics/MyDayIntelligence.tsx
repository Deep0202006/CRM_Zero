"use client";

import type { AnalyticsMetric } from "@/lib/analytics/viewModels";
import { AnalyticsBoundary, AnalyticsPanel } from "./AnalyticsPanel";
import { IndependentMetricBars, UrgencyTracker } from "./MetricOrbit";

export default function MyDayIntelligence({ focus, urgency }: { focus: AnalyticsMetric[]; urgency: AnalyticsMetric[] }) {
  return (
    <AnalyticsBoundary>
      <section className="analytics-shell" aria-label="Daily command center visual intelligence">
        <AnalyticsPanel
          eyebrow="Daily command center"
          title="Independent work signals"
          description="Already-loaded work signals stay separate; unlike counts are never summed into a fabricated focus total."
          labelledBy="my-day-work-signals"
        >
          <IndependentMetricBars metrics={focus} valueLabel="Focus signals" />
        </AnalyticsPanel>
        <AnalyticsPanel
          eyebrow="Task urgency"
          title="Task urgency"
          description="Missed, due-today, and scheduled-later task buckets from the existing My Day task model."
          labelledBy="my-day-urgency-ribbon"
        >
          <UrgencyTracker items={urgency} />
        </AnalyticsPanel>
      </section>
    </AnalyticsBoundary>
  );
}
