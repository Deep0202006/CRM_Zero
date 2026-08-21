"use client";
import { AnalyticsBoundary, AnalyticsEmptyState, AnalyticsPanel } from "./AnalyticsPanel";
import { MetricCard } from "@/components/ui/MetricCard";
import { NumberTicker } from "./NumberTicker";
export type FieldVisitErpSegment = { unique_businesses: number; observed_count: number; erp_using_count: number; none_count: number; not_captured_count: number; coverage_percent: number; categories: Array<{ erp_name: string; count: number; share_percent: number }> };
export default function FieldVisitErpIntelligence({ segments }: { segments: Record<string, FieldVisitErpSegment> }) {
  const retailer = segments.Retailer, distributor = segments.Distributor;
  const panel = (name: string, value?: FieldVisitErpSegment) => <AnalyticsPanel eyebrow="Current footprint" title={`${name} ERP Footprint`} description="Latest confirmed ERP observation per unique business. Each business is counted once; repeat visits do not inflate totals." labelledBy={`${name}-erp-footprint`}>
    {!value?.unique_businesses ? <AnalyticsEmptyState title="No field observations" description="ERP observations will appear after confirmed visits." /> : <div className="space-y-3">{value.categories.map((category) => <div key={category.erp_name}><div className="mb-1 flex justify-between gap-3 text-xs"><span>{category.erp_name}</span><span>{category.count} · {category.share_percent}%</span></div><div className="h-2 overflow-hidden rounded bg-[var(--surface-secondary)]"><div className="h-full rounded bg-[var(--viz-primary)]" style={{ width: `${category.share_percent}%` }} /></div></div>)}</div>}
  </AnalyticsPanel>;
  return <AnalyticsBoundary><div className="space-y-5"><div className="metric-grid"><MetricCard label="Retailer Businesses" value={<NumberTicker value={retailer?.unique_businesses ?? 0} />} /><MetricCard label="Retailer ERP Coverage" value={`${retailer?.coverage_percent ?? 0}%`} /><MetricCard label="Distributor Businesses" value={<NumberTicker value={distributor?.unique_businesses ?? 0} />} /><MetricCard label="Distributor ERP Coverage" value={`${distributor?.coverage_percent ?? 0}%`} /></div><section className="analytics-shell">{panel("Retailer", retailer)}{panel("Distributor", distributor)}</section></div></AnalyticsBoundary>;
}
