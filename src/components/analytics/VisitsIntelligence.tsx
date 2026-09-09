"use client";

import type { VisitAnalyticsModel } from "@/lib/analytics/viewModels";
import { CompositionStrip } from "./CompositionStrip";

export default function VisitsIntelligence({ model, matchedTotal, page, onOutcome }: { model: VisitAnalyticsModel; matchedTotal: number; page: number; onOutcome?: (key: string) => void }) {
  return <CompositionStrip items={model.outcomes} total={model.representedTotal} scope={`Current bounded page ${page} · ${model.representedTotal} of ${matchedTotal} matching visits`} onSelect={onOutcome} />;
}
