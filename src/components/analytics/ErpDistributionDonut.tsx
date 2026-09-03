"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AnalyticsEmptyState, AnalyticsPanel } from "./AnalyticsPanel";
import { NumberTicker } from "./NumberTicker";
import { ChartContainer, ChartTooltipContent } from "./Chart";

export type ErpDistributionState = "erp" | "none" | "not_captured" | "unset";
export type ErpDistributionCategory = {
  erp_name: string | null;
  state: ErpDistributionState;
  count: number;
};

const ERP_COLORS = Array.from({ length: 8 }, (_, index) => `var(--viz-series-${index + 1})`);
const tooltipStyle = { backgroundColor: "var(--surface-elevated)", border: "1px solid var(--border-default)", borderRadius: "var(--radius-md)", boxShadow: "var(--shadow-popover)", color: "var(--text-primary)", fontSize: 12 };

export function stableErpColor(erpName: string): string {
  const key = erpName.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-IN");
  let hash = 2166136261;
  for (let index = 0; index < key.length; index++) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  return ERP_COLORS[(hash >>> 0) % ERP_COLORS.length];
}

export function erpDistributionLabel(category: ErpDistributionCategory) {
  if (category.state === "none") return "None (explicit)";
  if (category.state === "not_captured") return "Not captured (unknown)";
  if (category.state === "unset") return "ERP Not Set";
  return category.erp_name ?? "ERP Not Set";
}

export function erpDistributionReconciles(categories: Pick<ErpDistributionCategory, "count">[], total: number) {
  return categories.reduce((sum, category) => sum + category.count, 0) === total;
}

export function ErpDistributionDonut({ title, description, total, totalLabel, categories, reconciled, emptyTitle, emptyDescription, labelledBy, ariaLabel }: {
  title: string;
  description: string;
  total: number;
  totalLabel: string;
  categories: ErpDistributionCategory[];
  reconciled: boolean;
  emptyTitle: string;
  emptyDescription: string;
  labelledBy: string;
  ariaLabel?: string;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const slices = categories.map((category) => ({
    ...category,
    key: category.state === "erp" ? `erp:${category.erp_name?.normalize("NFKC").trim().toLocaleLowerCase("en-IN")}` : category.state,
    label: erpDistributionLabel(category),
    color: category.state === "none" ? "var(--viz-warning)" : category.state === "not_captured" || category.state === "unset" ? "var(--viz-muted)" : stableErpColor(category.erp_name ?? ""),
    share: total ? category.count / total : 0,
  }));
  const visibleSlices = slices.filter((slice) => slice.count > 0);
  return <AnalyticsPanel eyebrow="Current footprint" title={title} description={description} labelledBy={labelledBy}>
    {!total ? <AnalyticsEmptyState title={emptyTitle} description={emptyDescription} /> : !reconciled ? <AnalyticsEmptyState title="ERP footprint unavailable" description="Category totals do not reconcile with the displayed total, so the donut is hidden instead of presenting misleading intelligence." /> : visibleSlices.length > 6 ? <ChartContainer config={{ count: { label: totalLabel, color: "var(--viz-primary)" } }} className="h-[320px] w-full" >
      <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 520, height: 320 }}><BarChart data={visibleSlices} layout="vertical" margin={{ top: 4, right: 28, bottom: 4, left: 18 }} accessibilityLayer><CartesianGrid horizontal={false} stroke="var(--viz-grid)" strokeDasharray="4 5" /><XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "var(--text-muted)", fontSize: 10 }} /><YAxis type="category" dataKey="label" width={120} tickLine={false} axisLine={false} tick={{ fill: "var(--text-secondary)", fontSize: 10 }} /><Tooltip cursor={{ fill: "var(--surface-hover)" }} content={<ChartTooltipContent />} /><Bar dataKey="count" radius={[0, 6, 6, 0]} maxBarSize={24} isAnimationActive={false}>{visibleSlices.map((slice) => <Cell key={slice.key} fill={slice.color} />)}</Bar></BarChart></ResponsiveContainer>
    </ChartContainer> : <div className="grid gap-4 lg:grid-cols-[minmax(220px,1fr)_minmax(220px,1fr)]" aria-label={ariaLabel ?? `${title}: ${total} ${totalLabel.toLowerCase()}`}>
      <div className="relative mx-auto h-[260px] w-full max-w-[340px]" data-chart-height="stable"><ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 260 }}><PieChart accessibilityLayer><Pie data={visibleSlices} dataKey="count" nameKey="label" innerRadius="62%" outerRadius="88%" paddingAngle={total > 1 ? 2 : 0} cornerRadius={6} stroke="var(--surface-primary)" strokeWidth={2} rootTabIndex={0} isAnimationActive={false} onMouseEnter={(_, index) => setActiveIndex(index)} onMouseLeave={() => setActiveIndex(null)}>{visibleSlices.map((slice, index) => <Cell key={slice.key} fill={slice.color} opacity={activeIndex == null || activeIndex === index ? 1 : 0.35} />)}</Pie><Tooltip formatter={(count, _name, item) => [`${Number(count).toLocaleString("en-IN")} (${(Number(item.payload.share) * 100).toFixed(1)}%)`, item.payload.label]} contentStyle={tooltipStyle} /></PieChart></ResponsiveContainer><div className="pointer-events-none absolute inset-0 grid place-items-center text-center"><div><NumberTicker value={total} className="block text-[32px] font-semibold" /><span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">{totalLabel}</span></div></div></div>
      <div className="max-h-[270px] space-y-1.5 overflow-y-auto pr-1" aria-label={`${title} legend`}>{slices.map((slice) => <div key={slice.key} className="analytics-legend-row"><span className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: slice.color }} aria-hidden="true" /><span className="truncate text-[12px] text-[var(--text-secondary)]">{slice.label}</span></span><span className="text-right text-[11px] tabular-nums text-[var(--text-muted)]"><strong className="text-[12px] text-[var(--text-primary)]">{slice.count}</strong> · {(slice.share * 100).toFixed(1)}%</span></div>)}</div>
      <p className="sr-only">{slices.map((slice) => `${slice.label}: ${slice.count} of ${total}.`).join(" ")}</p>
    </div>}
  </AnalyticsPanel>;
}
