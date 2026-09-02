"use client";

import type { AnalyticsMetric, TeamKpiAnalyticsRow } from "@/lib/analytics/viewModels";
import { AnalyticsBoundary, AnalyticsPanel } from "./AnalyticsPanel";
import { ContributionRing, KpiRadarProfile } from "./CompositionCharts";
import { MetricOrbit } from "./MetricOrbit";

export default function TeamKpiIntelligence({ rows, pulse }: { rows: TeamKpiAnalyticsRow[]; pulse: AnalyticsMetric[] }) {
  return (
    <AnalyticsBoundary>
      <section className="analytics-shell" aria-label="Team intelligence visualizations">
        <AnalyticsPanel
          eyebrow="Team pulse · Today"
          title="Work by type"
          description="Independent same-day confirmed work counts. Unlike work types are not combined into a score."
          labelledBy="team-kpi-pulse"
          className="xl:col-span-2"
        >
          <MetricOrbit metrics={pulse} centerLabel="Recorded work" />
        </AnalyticsPanel>
        <AnalyticsPanel
          eyebrow="Contribution"
          title="Employee contribution"
          description="Select a real KPI dimension to compare exact same-unit employee values. This is not a productivity rank."
          labelledBy="team-kpi-contribution"
        >
          <ContributionRing rows={rows} />
        </AnalyticsPanel>
        <AnalyticsPanel
          eyebrow="Relative KPI profile"
          title="Employee shape vs team"
          description="Unit-safe, per-dimension normalization for visual comparison; raw values remain in the tooltip."
          labelledBy="team-kpi-radar"
        >
          <KpiRadarProfile rows={rows} />
        </AnalyticsPanel>
      </section>
    </AnalyticsBoundary>
  );
}
