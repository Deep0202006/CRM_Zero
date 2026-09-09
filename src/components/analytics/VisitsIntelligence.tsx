"use client";

import type { VisitAnalyticsModel } from "@/lib/analytics/viewModels";
import { AnalyticsBoundary, AnalyticsPanel } from "./AnalyticsPanel";
import { ActivityFlow, FieldMix, OutcomeDonut } from "./CompositionCharts";

export default function VisitsIntelligence({ model, matchedTotal, page }: { model: VisitAnalyticsModel; matchedTotal: number; page: number }) {
  const scope = `Current bounded page ${page} · ${model.representedTotal} of ${matchedTotal} matching visits`;
  return (
    <AnalyticsBoundary>
      <section className="analytics-shell" aria-label="Field activity intelligence">
        <AnalyticsPanel
          title="Outcome composition"
          description="Every loaded visit is represented once, including unknown historical outcomes."
          coverage={scope}
          labelledBy="visits-outcome-donut"
        >
          <OutcomeDonut outcomes={model.outcomes} total={model.representedTotal} />
        </AnalyticsPanel>
        <AnalyticsPanel
          title="Loaded visit rhythm"
          description="Daily retailer, distributor and other visits from this page, using India check-in dates."
          coverage={`${scope}. Loaded dates only; not a complete period trend.`}
          labelledBy="visits-activity-flow"
        >
          <ActivityFlow points={model.activity} />
        </AnalyticsPanel>
        <AnalyticsPanel
          title="Retailer and distributor mix"
          description="Mutually exclusive business segments from the loaded records."
          coverage={scope}
          labelledBy="visits-field-mix"
          className="xl:col-span-2"
        >
          <div className="mx-auto w-full max-w-3xl"><FieldMix metrics={model.fieldMix} total={model.representedTotal} /></div>
        </AnalyticsPanel>
      </section>
    </AnalyticsBoundary>
  );
}
