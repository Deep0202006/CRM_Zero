"use client";

import type { AnalyticsMetric, TeamKpiAnalyticsRow } from "@/lib/analytics/viewModels";
import { AnalyticsBoundary, AnalyticsPanel } from "./AnalyticsPanel";
import { EmployeeContributionBars as ContributionRing, EmployeeTeamComparison as KpiRadarProfile } from "./CompositionCharts";
import { IndependentMetricBars } from "./MetricOrbit";

export default function TeamKpiIntelligence({ rows, pulse }: { rows: TeamKpiAnalyticsRow[]; pulse: AnalyticsMetric[] }) {
  return (
    <AnalyticsBoundary>
      <section className="analytics-shell" aria-label="Team intelligence visualizations">
        <AnalyticsPanel
          eyebrow="Team pulse · Today"
          title="Work by type"
          description="Independent same-day confirmed work counts. Unlike work types are not combined into a score. No historical trend is implied."
          labelledBy="team-kpi-pulse"
          className="xl:col-span-2"
        >
          <IndependentMetricBars metrics={pulse} valueLabel="Recorded work" />
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
          eyebrow="Employee comparison"
          title="Employee vs team average"
          description="Grouped raw values compare one employee with the team average for each KPI dimension. This is not a normalized score."
          labelledBy="team-kpi-comparison"
        >
          <KpiRadarProfile rows={rows} />
        </AnalyticsPanel>
      </section>
    </AnalyticsBoundary>
  );
}
