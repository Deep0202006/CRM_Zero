import fs from "node:fs";
import path from "node:path";
import {
  buildCallReachComposition,
  buildDistributorMilestones,
  buildErpCoverageRows,
  buildRenewalUrgency,
  metricTotal,
  partitionReconciles,
} from "@/lib/analytics/viewModels";

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

describe("visual intelligence v2", () => {
  const chartSources = [
    "src/components/analytics/Chart.tsx",
    "src/components/analytics/CompositionCharts.tsx",
    "src/components/analytics/MetricOrbit.tsx",
    "src/components/analytics/ErpDistributionDonut.tsx",
    "src/components/analytics/FieldVisitErpIntelligence.tsx",
    "src/components/analytics/MyDayIntelligence.tsx",
    "src/components/analytics/TeamKpiIntelligence.tsx",
    "src/components/analytics/VisitsIntelligence.tsx",
  ].map(read).join("\n");

  it("uses one local shadcn-style Recharts primitive layer with no data access", () => {
    const primitives = read("src/components/analytics/Chart.tsx");
    expect(primitives).toContain("ChartConfig");
    expect(primitives).toContain("ChartContainer");
    expect(primitives).toContain("ChartTooltipContent");
    expect(primitives).toContain("ChartLegendContent");
    expect(chartSources).not.toMatch(/fetch\(|supabase|\.from\(["']|\.rpc\(["']|setInterval|\.channel\(/i);
  });

  it("retires misleading primary circular and radar comparisons", () => {
    const composition = read("src/components/analytics/CompositionCharts.tsx");
    const orbit = read("src/components/analytics/MetricOrbit.tsx");
    const manager = read("src/app/manager/kpi/FunnelTab.tsx");
    expect(orbit).toContain('layout="vertical"');
    expect(read("src/components/analytics/TeamKpiIntelligence.tsx")).toContain('title="Employee contribution"');
    expect(read("src/components/analytics/TeamKpiIntelligence.tsx")).toContain('title="Employee vs team average"');
    expect(composition).toContain("Grouped same-unit comparisons");
    expect(composition).not.toMatch(/RadarChart|Radar|PolarGrid/);
    expect(manager).not.toContain("FunnelChart");
  });

  it("adapts high-cardinality composition to bars and preserves represented totals", () => {
    const erp = read("src/components/analytics/ErpDistributionDonut.tsx");
    const composition = read("src/components/analytics/CompositionCharts.tsx");
    expect(erp).toContain("visibleSlices.length > 6");
    expect(composition).toContain("chartOutcomes.length > 6");
    expect(erp).toContain("reconciled");
  });

  it("only renders 100% compositions when their exact partition reconciles", () => {
    expect(partitionReconciles([{ value: 2 }, { value: 3 }], 5)).toBe(true);
    expect(partitionReconciles([{ value: 2 }, { value: 2 }], 5)).toBe(false);
    expect(buildCallReachComposition(7, 5)).toEqual([
      expect.objectContaining({ key: "reached", value: 5 }),
      expect.objectContaining({ key: "no_response", value: 2 }),
    ]);
    expect(buildCallReachComposition(4, 5)).toBeNull();
  });

  it("keeps renewal urgency and distributor milestones ordered and independent", () => {
    const renewals = buildRenewalUrgency({ overdue: 4, today: 3, tomorrow: 2, in_two_days: 1 });
    expect(renewals.map((item) => item.label)).toEqual(["Overdue", "Today", "Tomorrow", "In two days"]);
    expect(metricTotal(buildRenewalUrgency({ overdue: 0, today: 0, tomorrow: 0, in_two_days: 0 }))).toBe(0);
    expect(buildDistributorMilestones({ installation_training_done: 8, mapped: 5, billed: 3 }).map((item) => [item.key, item.value])).toEqual([
      ["installation_training_done", 8], ["mapped", 5], ["billed", 3],
    ]);
  });

  it("clamps the paired ERP coverage visual to a truthful 0–100 scale", () => {
    expect(buildErpCoverageRows({ Retailer: { coverage_percent: 64 }, Distributor: { coverage_percent: 132 } })).toEqual([
      { key: "retailer", label: "Retailer", value: 64 },
      { key: "distributor", label: "Distributor", value: 100 },
    ]);
  });
});
