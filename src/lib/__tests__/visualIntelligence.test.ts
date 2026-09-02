import fs from "node:fs";
import path from "node:path";
import {
  buildRelativeKpiProfile,
  buildVisitAnalytics,
  getContributionRows,
  metricTotal,
  type TeamKpiAnalyticsRow,
} from "@/lib/analytics/viewModels";

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

const teamRows: TeamKpiAnalyticsRow[] = [
  { user_id: "10000000-0000-4000-a000-000000000001", name: "Asha", calls_made: 8, queries_handled: 2, mappings_completed: 1, tasks_completed: 4 },
  { user_id: "20000000-0000-4000-a000-000000000001", name: "Mira", calls_made: 2, queries_handled: 4, mappings_completed: 3, tasks_completed: 0 },
  { user_id: "30000000-0000-4000-a000-000000000001", name: "Neha", calls_made: 0, queries_handled: 0, mappings_completed: 0, tasks_completed: 0 },
];

describe("visual intelligence truth models", () => {
  it("reconciles every loaded visit into one known or explicit historical outcome", () => {
    const model = buildVisitAnalytics([
      { visit_id: "1", visit_outcome: "installed", segment_type: "Retailer", check_in_time: "2026-08-14T18:45:00.000Z" },
      { visit_id: "2", visit_outcome: "payment_done", segment_type: "Distributor", check_in_time: "2026-08-14T19:15:00.000Z" },
      { visit_id: "3", visit_outcome: "legacy_result", segment_type: null, check_in_time: "2026-08-15T03:30:00.000Z" },
    ]);

    expect(model.representedTotal).toBe(3);
    expect(model.outcomes.reduce((sum, item) => sum + item.value, 0)).toBe(3);
    expect(model.outcomes.find((item) => item.key === "unknown")?.value).toBe(1);
    expect(model.fieldMix.reduce((sum, item) => sum + item.value, 0)).toBe(3);
  });

  it("buckets visits by shared IST dates and caps the real series at 31 points", () => {
    const boundary = buildVisitAnalytics([
      { visit_id: "1", visit_outcome: "installed", segment_type: "Retailer", check_in_time: "2026-08-14T18:29:59.000Z" },
      { visit_id: "2", visit_outcome: "installed", segment_type: "Retailer", check_in_time: "2026-08-14T18:30:00.000Z" },
    ]);
    expect(boundary.activity.map((point) => point.date)).toEqual(["2026-08-14", "2026-08-15"]);

    const fortyDays = Array.from({ length: 40 }, (_, index) => ({
      visit_id: String(index),
      visit_outcome: "interested",
      segment_type: index % 2 ? "Distributor" : "Retailer",
      check_in_time: new Date(Date.UTC(2026, 0, index + 1, 6)).toISOString(),
    }));
    expect(buildVisitAnalytics(fortyDays).activity).toHaveLength(31);
  });

  it("keeps KPI contribution totals exact and radar normalization unit-local", () => {
    const calls = getContributionRows(teamRows, "calls_made");
    expect(calls.total).toBe(10);
    expect(calls.rows).toHaveLength(teamRows.length);
    expect(calls.rows.reduce((sum, row) => sum + row.value, 0)).toBe(calls.total);

    const profile = buildRelativeKpiProfile(teamRows, teamRows[0].user_id);
    expect(profile.find((point) => point.metric === "Calls")).toMatchObject({ employee: 100, employeeRaw: 8, max: 8 });
    expect(profile.every((point) => point.employee >= 0 && point.employee <= 100 && point.team >= 0 && point.team <= 100)).toBe(true);
    expect(metricTotal(teamRows.map((row) => ({ value: row.calls_made })))).toBe(10);
  });
});

describe("visual intelligence resource and authority guards", () => {
  const analyticsSources = [
    "src/components/analytics/AnalyticsPanel.tsx",
    "src/components/analytics/CompositionCharts.tsx",
    "src/components/analytics/MetricOrbit.tsx",
    "src/components/analytics/MyDayIntelligence.tsx",
    "src/components/analytics/TeamKpiIntelligence.tsx",
    "src/components/analytics/VisitsIntelligence.tsx",
    "src/lib/analytics/viewModels.ts",
  ].map(read).join("\n");

  it("keeps charts presentation-only", () => {
    expect(analyticsSources).not.toMatch(/fetch\(|supabase|\.from\(|\.rpc\(|setInterval|\.channel\(|localStorage|indexedDB/i);
    expect(analyticsSources).not.toMatch(/from ["'](?:@?nivo|chart\.js|echarts|@tremor\/react|@?heroui|react-bits)/i);
  });

  it("adds zero page polling and preserves one initial metrics/list request per authoritative screen", () => {
    const team = read("src/app/manager/kpi/page.tsx");
    const visits = read("src/app/admin/visits/page.tsx");
    const myDayVisual = read("src/components/analytics/MyDayIntelligence.tsx");
    expect((team.match(/fetch\("\/api\/team-kpi"/g) ?? [])).toHaveLength(1);
    expect((visits.match(/fetch\(`\/api\/admin\/visits\?\$\{params\}`/g) ?? [])).toHaveLength(1);
    expect([team, visits, myDayVisual].join("\n")).not.toContain("setInterval");
  });

  it("declares stable chart dimensions, reduced-motion protection, and no fake score", () => {
    expect(analyticsSources).toContain('data-chart-height="stable"');
    expect(read("src/app/globals.css")).toContain("@media (prefers-reduced-motion: reduce)");
    expect(analyticsSources).not.toMatch(/(?:title|label|heading)[^\n]*(?:performance score|employee score|rank|grade)/i);
    expect(analyticsSources).toContain("This is not a score or rank.");
  });
});
