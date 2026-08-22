"use client";

import { useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { AnalyticsBoundary, AnalyticsEmptyState, AnalyticsPanel } from "./AnalyticsPanel";
import { MetricCard } from "@/components/ui/MetricCard";
import { NumberTicker } from "./NumberTicker";

export type FieldVisitErpCategory = { erp_name: string; state?: "erp" | "none" | "not_captured"; count: number; share_percent: number };
export type FieldVisitErpSegment = { unique_businesses: number; observed_count: number; erp_using_count: number; none_count: number; not_captured_count: number; coverage_percent: number; categories: FieldVisitErpCategory[] };
export type ErpDonutSlice = FieldVisitErpCategory & { key: string; label: string; color: string; share: number };

const ERP_COLORS = Array.from({ length: 8 }, (_, index) => `var(--viz-series-${index + 1})`);
const tooltipStyle = { backgroundColor: "var(--surface-elevated)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-popover)", color: "var(--text-primary)", fontSize: 12 };

function categoryState(category: FieldVisitErpCategory): "erp" | "none" | "not_captured" {
  if (category.state) return category.state;
  if (category.erp_name === "None") return "none";
  if (category.erp_name === "Not captured") return "not_captured";
  return "erp";
}

export function stableErpColor(erpName: string): string {
  const key = erpName.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-IN");
  let hash = 2166136261;
  for (let index = 0; index < key.length; index++) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  return ERP_COLORS[(hash >>> 0) % ERP_COLORS.length];
}

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
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const model = buildErpDonutModel(value);
  const visibleSlices = model.slices.filter((slice) => slice.count > 0);
  return <AnalyticsPanel eyebrow="Current footprint" title={`${name} ERP Footprint`} description="Current ERP per exact business identity using the latest authoritative visit or Admin baseline. Each business is counted once; repeat visits do not inflate totals." labelledBy={`${name.toLowerCase()}-erp-footprint`}>
    {!value?.unique_businesses ? <AnalyticsEmptyState title="No visited businesses" description="Current ERP intelligence will appear after a confirmed visit creates a stable business identity." /> : !model.reconciled ? <AnalyticsEmptyState title="ERP footprint unavailable" description="Category totals do not reconcile with the unique-business total, so the donut is hidden instead of presenting misleading intelligence." /> : <div className="grid gap-4 lg:grid-cols-[minmax(220px,1fr)_minmax(220px,1fr)]" aria-label={`${name} current ERP footprint: ${value.unique_businesses} unique businesses`}>
      <div className="relative mx-auto h-[260px] w-full max-w-[340px]" data-chart-height="stable"><ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 260 }}><PieChart accessibilityLayer><Pie data={visibleSlices} dataKey="count" nameKey="label" innerRadius="62%" outerRadius="88%" paddingAngle={value.unique_businesses > 1 ? 2 : 0} cornerRadius={6} stroke="var(--surface-primary)" strokeWidth={2} rootTabIndex={0} isAnimationActive={false} onMouseEnter={(_, index) => setActiveIndex(index)} onMouseLeave={() => setActiveIndex(null)}>{visibleSlices.map((slice, index) => <Cell key={slice.key} fill={slice.color} opacity={activeIndex == null || activeIndex === index ? 1 : 0.35} />)}</Pie><Tooltip formatter={(count, _name, item) => [`${Number(count).toLocaleString("en-IN")} (${(Number(item.payload.share) * 100).toFixed(1)}%)`, item.payload.label]} contentStyle={tooltipStyle} /></PieChart></ResponsiveContainer><div className="pointer-events-none absolute inset-0 grid place-items-center text-center"><div><NumberTicker value={value.unique_businesses} className="block text-[32px] font-semibold" /><span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">{name === "Retailer" ? "Retailers" : "Distributors"}</span></div></div></div>
      <div className="max-h-[270px] space-y-1.5 overflow-y-auto pr-1" aria-label={`${name} ERP footprint legend`}>{model.slices.map((slice) => <div key={slice.key} className="analytics-legend-row"><span className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: slice.color }} aria-hidden="true" /><span className="truncate text-[12px] text-[var(--text-secondary)]">{slice.label}</span></span><span className="text-right text-[11px] tabular-nums text-[var(--text-muted)]"><strong className="text-[12px] text-[var(--text-primary)]">{slice.count}</strong> · {(slice.share * 100).toFixed(1)}%</span></div>)}</div>
      <p className="sr-only">{model.slices.map((slice) => `${slice.label}: ${slice.count} of ${value.unique_businesses}.`).join(" ")}</p>
    </div>}
  </AnalyticsPanel>;
}

export default function FieldVisitErpIntelligence({ segments }: { segments: Record<string, FieldVisitErpSegment> }) {
  const retailer = segments.Retailer, distributor = segments.Distributor;
  return <AnalyticsBoundary><div className="space-y-5"><div className="metric-grid"><MetricCard label="Retailer Businesses" value={<NumberTicker value={retailer?.unique_businesses ?? 0} />} /><MetricCard label="Retailer ERP Coverage" value={`${retailer?.coverage_percent ?? 0}%`} /><MetricCard label="Distributor Businesses" value={<NumberTicker value={distributor?.unique_businesses ?? 0} />} /><MetricCard label="Distributor ERP Coverage" value={`${distributor?.coverage_percent ?? 0}%`} /></div><section className="analytics-shell" aria-label="Current ERP footprint intelligence"><ErpFootprintDonut name="Retailer" value={retailer} /><ErpFootprintDonut name="Distributor" value={distributor} /></section></div></AnalyticsBoundary>;
}
