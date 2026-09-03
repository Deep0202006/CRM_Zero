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
          eyebrow="Field activity intelligence"
          title="Outcome composition"
          description={`${scope}. Every loaded visit is represented exactly once, including historical unknown outcomes.`}
          labelledBy="visits-outcome-donut"
        >
          <OutcomeDonut outcomes={model.outcomes} total={model.representedTotal} />
        </AnalyticsPanel>
        <AnalyticsPanel
          eyebrow="Activity flow"
          title="Loaded visit rhythm"
          description={`${scope}. Series use the shared Asia/Kolkata business-date authority.`}
          labelledBy="visits-activity-flow"
        >
          <ActivityFlow points={model.activity} />
        </AnalyticsPanel>
        <AnalyticsPanel
          eyebrow="Field mix"
          title="Retailer and distributor mix"
          description={`Segment composition for ${scope.toLowerCase()}.`}
          labelledBy="visits-field-mix"
          className="xl:col-span-2"
        >
          <div className="mx-auto w-full max-w-3xl"><FieldMix metrics={model.fieldMix} total={model.representedTotal} /></div>
        </AnalyticsPanel>
      </section>
    </AnalyticsBoundary>
  );
}
