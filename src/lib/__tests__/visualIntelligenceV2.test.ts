import fs from "node:fs";
import path from "node:path";

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

describe("visual intelligence v2", () => {
  const chartSources = [
    "src/components/analytics/Chart.tsx",
    "src/components/analytics/CompositionCharts.tsx",
    "src/components/analytics/MetricOrbit.tsx",
    "src/components/analytics/ErpDistributionDonut.tsx",
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
    expect(composition).toContain("Grouped same-unit comparisons");
    expect(manager).not.toContain("FunnelChart");
  });

  it("adapts high-cardinality composition to bars and preserves represented totals", () => {
    const erp = read("src/components/analytics/ErpDistributionDonut.tsx");
    const composition = read("src/components/analytics/CompositionCharts.tsx");
    expect(erp).toContain("visibleSlices.length > 6");
    expect(composition).toContain("chartOutcomes.length > 6");
    expect(erp).toContain("reconciled");
  });
});
