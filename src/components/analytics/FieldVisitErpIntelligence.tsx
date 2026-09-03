"use client";

import { AnalyticsBoundary, AnalyticsPanel } from "./AnalyticsPanel";
import { ErpDistributionDonut, stableErpColor, type ErpDistributionCategory } from "./ErpDistributionDonut";
import { MetricCard } from "@/components/ui/MetricCard";
import { NumberTicker } from "./NumberTicker";
import { buildErpCoverageRows } from "@/lib/analytics/viewModels";

export type FieldVisitErpCategory = { erp_name: string; state?: "erp" | "none" | "not_captured"; count: number; share_percent: number };
export type FieldVisitErpSegment = { unique_businesses: number; observed_count: number; erp_using_count: number; none_count: number; not_captured_count: number; coverage_percent: number; categories: FieldVisitErpCategory[] };
export type ErpDonutSlice = FieldVisitErpCategory & ErpDistributionCategory & { key: string; label: string; color: string; share: number };

function categoryState(category: FieldVisitErpCategory): "erp" | "none" | "not_captured" {
  if (category.state) return category.state;
  if (category.erp_name === "None") return "none";
  if (category.erp_name === "Not captured") return "not_captured";
  return "erp";
}

export { stableErpColor };

export function buildErpDonutModel(segment: FieldVisitErpSegment | undefined): { reconciled: boolean; slices: ErpDonutSlice[] } {
  if (!segment) return { reconciled: true, slices: [] };
  const slices = segment.categories.map((category) => {
    const state = categoryState(category);
    return { ...category, state, key: state === "erp" ? `erp:${category.erp_name.normalize("NFKC").trim().toLocaleLowerCase("en-IN")}` : state, label: state === "none" ? "None (explicit)" : state === "not_captured" ? "Not captured (unknown)" : category.erp_name, color: state === "none" ? "var(--viz-warning)" : state === "not_captured" ? "var(--viz-muted)" : stableErpColor(category.erp_name), share: segment.unique_businesses ? category.count / segment.unique_businesses : 0 };
  });
  const total = slices.reduce((sum, slice) => sum + slice.count, 0);
  const byState = (state: "erp" | "none" | "not_captured") => slices.filter((slice) => slice.state === state).reduce((sum, slice) => sum + slice.count, 0);
  return { reconciled: total === segment.unique_businesses && byState("erp") === segment.erp_using_count && byState("none") === segment.none_count && byState("not_captured") === segment.not_captured_count && segment.observed_count === segment.erp_using_count + segment.none_count, slices };
}

function ErpFootprintDonut({ name, value }: { name: "Retailer" | "Distributor"; value?: FieldVisitErpSegment }) {
  const model = buildErpDonutModel(value);
  return <ErpDistributionDonut title={`${name} ERP Footprint`} description="Current ERP per exact business identity using the latest authoritative visit or Admin baseline. Each business is counted once; repeat visits do not inflate totals." labelledBy={`${name.toLowerCase()}-erp-footprint`} ariaLabel={`${name} current ERP footprint: ${value?.unique_businesses ?? 0} unique businesses`} total={value?.unique_businesses ?? 0} totalLabel={name === "Retailer" ? "Retailers" : "Distributors"} categories={model.slices} reconciled={model.reconciled} emptyTitle="No visited businesses" emptyDescription="Current ERP intelligence will appear after a confirmed visit creates a stable business identity." />;
}

export default function FieldVisitErpIntelligence({ segments }: { segments: Record<string, FieldVisitErpSegment> }) {
  const retailer = segments.Retailer, distributor = segments.Distributor;
  const coverage = buildErpCoverageRows(segments);
  return <AnalyticsBoundary><div className="space-y-5"><div className="metric-grid"><MetricCard label="Retailer Businesses" value={<NumberTicker value={retailer?.unique_businesses ?? 0} />} /><MetricCard label="Retailer ERP Coverage" value={`${retailer?.coverage_percent ?? 0}%`} /><MetricCard label="Distributor Businesses" value={<NumberTicker value={distributor?.unique_businesses ?? 0} />} /><MetricCard label="Distributor ERP Coverage" value={`${distributor?.coverage_percent ?? 0}%`} /></div><AnalyticsPanel eyebrow="Coverage comparison" title="Retailer vs distributor ERP coverage" description="Paired 0–100% coverage from the already-loaded authoritative segment aggregates." labelledBy="field-erp-coverage"><div className="space-y-4">{coverage.map((row) => <div key={row.key}><div className="mb-1.5 flex items-center justify-between text-xs"><span className="font-medium text-[var(--text-secondary)]">{row.label}</span><span className="font-semibold tabular-nums">{row.value}%</span></div><div className="h-3 overflow-hidden rounded-full bg-[var(--viz-track)]"><div className="h-full rounded-full bg-[var(--viz-primary)]" style={{ width: `${row.value}%` }} /></div></div>)}</div></AnalyticsPanel><section className="analytics-shell" aria-label="Current ERP footprint intelligence"><ErpFootprintDonut name="Retailer" value={retailer} /><ErpFootprintDonut name="Distributor" value={distributor} /></section></div></AnalyticsBoundary>;
}
