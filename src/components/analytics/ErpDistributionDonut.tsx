"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, Tooltip, XAxis, YAxis } from "recharts";
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
  return Number.isInteger(total) && total >= 0 && categories.every((category) => Number.isInteger(category.count) && category.count >= 0) && categories.reduce((sum, category) => sum + category.count, 0) === total;
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
  const valid = reconciled && erpDistributionReconciles(categories, total);
  return <AnalyticsPanel eyebrow="Current footprint" title={title} description={description} labelledBy={labelledBy}>
    {!valid ? <AnalyticsEmptyState title="ERP footprint unavailable" description="Category totals do not reconcile with the displayed total." /> : !total ? <AnalyticsEmptyState title={emptyTitle} description={emptyDescription} /> : <div className="grid gap-4" aria-label={ariaLabel ?? `${title}: ${total} ${totalLabel.toLowerCase()}`}>
      {visibleSlices.length > 6 ? <ChartContainer config={{ count: { label: totalLabel, color: "var(--viz-primary)" } }} className="h-[360px] w-full" initialDimension={{ width: 520, height: 360 }}>
        <BarChart data={visibleSlices} layout="vertical" margin={{ top: 4, right: 28, bottom: 4, left: 4 }} accessibilityLayer>
          <CartesianGrid horizontal={false} stroke="var(--viz-grid)" />
          <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="label" width={140} tickLine={false} axisLine={false} tick={{ fontSize: 12 }} />
          <Tooltip cursor={{ fill: "var(--surface-hover)" }} content={<ChartTooltipContent />} />
          <Bar dataKey="count" radius={[0, 5, 5, 0]} maxBarSize={24} isAnimationActive={false}>{visibleSlices.map((slice) => <Cell key={slice.key} fill={slice.color} />)}</Bar>
        </BarChart>
      </ChartContainer> : <div className="relative mx-auto h-[260px] w-full max-w-[340px]">
        <ChartContainer config={{ count: { label: totalLabel, color: "var(--viz-primary)" } }} className="h-full w-full" initialDimension={{ width: 320, height: 260 }}>
          <PieChart accessibilityLayer>
            <Pie data={visibleSlices} dataKey="count" nameKey="label" innerRadius="62%" outerRadius="88%" paddingAngle={total > 1 ? 2 : 0} cornerRadius={6} stroke="var(--surface-primary)" strokeWidth={2} rootTabIndex={0} isAnimationActive={false} onMouseEnter={(_, index) => setActiveIndex(index)} onMouseLeave={() => setActiveIndex(null)}>
              {visibleSlices.map((slice, index) => <Cell key={slice.key} fill={slice.color} opacity={activeIndex == null || activeIndex === index ? 1 : 0.35} />)}
            </Pie>
            <Tooltip content={<ChartTooltipContent nameKey="label" hideLabel valueFormatter={(value, item) => `${Number(value).toLocaleString("en-IN")} (${(Number(item.payload?.share ?? 0) * 100).toFixed(1)}%)`} />} />
          </PieChart>
        </ChartContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center"><div><NumberTicker value={total} className="block text-[32px] font-semibold" /><span className="text-xs text-[var(--text-secondary)]">{totalLabel}</span></div></div>
      </div>}
      <ul className="max-h-[320px] space-y-1.5 overflow-y-auto" aria-label={`${title} values`}>
        {slices.map((slice) => <li key={slice.key} className="analytics-legend-row text-xs"><span className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: slice.color }} aria-hidden="true" /><span className="break-words text-[var(--text-secondary)]">{slice.label}:</span></span><span className="shrink-0 tabular-nums">{slice.count.toLocaleString("en-IN")} <span className="text-[var(--text-secondary)]">of {total.toLocaleString("en-IN")} · {(slice.share * 100).toFixed(1)}%</span></span></li>)}
      </ul>
    </div>}
  </AnalyticsPanel>;
}
