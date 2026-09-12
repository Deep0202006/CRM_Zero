"use client";

import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { addISTDateDays } from "@/lib/dateTime";
import { ChartContainer, ChartTooltipContent } from "./Chart";

export function RetainedHistoryChart({ from, previousFrom, values, previousValues, label, scope }: {
  from: string; previousFrom: string; values: Array<number | null>; previousValues: Array<number | null>; label: string; scope: string;
}) {
  const daily = values.map((count, index) => ({ date: addISTDateDays(from, index), count }));
  return <section className="min-w-0 space-y-2" aria-label={`${scope} daily retained records`}>
    <h3 className="section-title text-balance">{label} by IST date</h3>
    <p className="text-xs text-[var(--text-secondary)]">{scope}. Zero means no retained records, not zero work. Missing source values remain gaps.</p>
    {values.some(value => value !== null) ? <ChartContainer config={{ count: { label, color: "var(--viz-primary)" } }} className="h-40 w-full" initialDimension={{ width: 640, height: 160 }}>
      <AreaChart data={daily} accessibilityLayer margin={{ left: 0, right: 16, top: 8, bottom: 8 }}>
        <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
        <XAxis dataKey="date" tickFormatter={(date: string) => date.slice(5)} tick={{ fill: "var(--text-secondary)", fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis allowDecimals={false} domain={[0, "auto"]} tick={{ fill: "var(--text-secondary)", fontSize: 12 }} width={40} tickLine={false} axisLine={false} />
        <Tooltip filterNull={false} content={<ChartTooltipContent />} />
        <Area dataKey="count" type="linear" connectNulls={false} stroke="var(--viz-primary)" fill="var(--viz-primary)" fillOpacity={0.12} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
      </AreaChart>
    </ChartContainer> : <p role="status" className="py-6 text-sm">Chart unavailable: selected source was not read completely.</p>}
    <details className="workspace-disclosure"><summary>Exact daily data · chart and previous retained records</summary>
      <div className="max-h-80 overflow-auto" role="region" aria-label="History daily data" tabIndex={0} data-allow-overflow="horizontal"><table className="w-full text-sm tabular-nums"><caption className="text-left">{scope} · {label}. Retained records, not complete work.</caption><thead><tr><th scope="col">IST date</th><th scope="col">Chart / retained count</th><th scope="col">Previous IST date</th><th scope="col">Previous retained count</th></tr></thead><tbody>{daily.map((point, index) => <tr key={point.date}><th scope="row">{point.date}</th><td>{point.count?.toLocaleString("en-IN") ?? "Gap / unavailable"}</td><td>{addISTDateDays(previousFrom, index)}</td><td>{previousValues[index]?.toLocaleString("en-IN") ?? "Unavailable"}</td></tr>)}</tbody></table></div>
    </details>
  </section>;
}
