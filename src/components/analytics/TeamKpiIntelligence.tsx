"use client";

import type { TeamKpiAnalyticsRow } from "@/lib/analytics/viewModels";
import { AnalyticsBoundary, AnalyticsPanel } from "./AnalyticsPanel";
import { EmployeeContributionBars, EmployeeTeamComparison } from "./CompositionCharts";

export default function TeamKpiIntelligence({ rows, comparison = false, comparisonAvailable = true }: { rows: TeamKpiAnalyticsRow[]; comparison?: boolean; comparisonAvailable?: boolean }) {
  return <AnalyticsBoundary>
    {comparison ? <AnalyticsPanel title="Employee vs team average" description="Optional descriptive reference using the full supplied cohort, including the selected employee." labelledBy="team-kpi-comparison">
      {comparisonAvailable ? <EmployeeTeamComparison rows={rows} /> : <p role="status" className="text-sm text-[var(--text-secondary)]">Comparison unavailable while sources are incomplete or the report could not refresh.</p>}
    </AnalyticsPanel> : <AnalyticsPanel title="Employee contribution" description="Select one confirmed work type to compare exact employee values. No historical trend is implied." labelledBy="team-kpi-contribution" coverage="Today · Asia/Kolkata · Supplied report participants. Unlike work types are not combined into a score.">
      <EmployeeContributionBars rows={rows} />
    </AnalyticsPanel>}
  </AnalyticsBoundary>;
}
