"use client";

import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import type { VisitRangeReport } from "@/lib/fieldVisits/range";
import { adminVisitOutcomeLabel } from "@/lib/fieldVisits/query";
import { VISIT_OUTCOMES } from "@/lib/analytics/viewModels";
import { ChartContainer, ChartTooltipContent } from "./Chart";
import { CompositionStrip } from "./CompositionStrip";

export default function VisitsIntelligence({ report, scope, matchedTotal, onOutcome, onRepresentative }: {
  report: VisitRangeReport; scope: string; matchedTotal: number;
  onOutcome: (key: string) => void; onRepresentative: (id: string) => void;
}) {
  return <section aria-label="Full-range Visit activity" className="space-y-2 tabular-nums">
    <header className="space-y-1"><h2 className="section-title text-balance">Retained visits across the applied range</h2>
      <p className="sr-only">{scope}</p>
      <p className="text-sm"><strong>{report.retained_visit_count.toLocaleString("en-IN")}</strong> retained Visit records · {report.daily.length} IST business dates</p>
      <p className="text-xs text-[var(--text-secondary)]">Read at {new Date(report.generated_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST. Retained source exhausted; historical capture completeness is not certified. Live reads are not an atomic snapshot. Today, when included, is partial.</p>
      {matchedTotal !== report.retained_visit_count && <p role="status" className="alert-panel alert-panel--warning">Register and analysis were read at different times: {matchedTotal} matching records versus {report.retained_visit_count} retained observations. Refresh analysis to reconcile; neither count replaces the other.</p>}
    </header>
    <p className="text-xs text-[var(--text-secondary)]">Zero means no retained Visit records on that date, not zero employee activity. No growth or revenue is inferred.</p>
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]"><ChartContainer config={{ count: { label: "Retained visits", color: "var(--viz-primary)" } }} className="h-40 w-full" initialDimension={{ width: 640, height: 160 }}>
      <AreaChart data={report.daily} accessibilityLayer margin={{ left: 0, right: 16, top: 16, bottom: 8 }}>
        <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
        <XAxis dataKey="date" tickFormatter={(value: string) => value.slice(5)} minTickGap={24} tickLine={false} axisLine={false} />
        <YAxis allowDecimals={false} domain={[0, "auto"]} width={40} tickLine={false} axisLine={false} />
        <Tooltip filterNull={false} content={<ChartTooltipContent />} />
        <Area dataKey="count" type="linear" connectNulls={false} stroke="var(--viz-primary)" fill="var(--viz-primary)" fillOpacity={0.12} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
      </AreaChart>
    </ChartContainer>
    <CompositionStrip items={report.outcomes.map(row => ({ key: row.outcome, label: row.outcome === "unknown" ? "Unknown / legacy outcome" : adminVisitOutcomeLabel(row.outcome), value: row.count, color: VISIT_OUTCOMES.find(item => item.key === row.outcome)?.color ?? "var(--viz-muted)" }))} total={report.retained_visit_count} scope="Full applied range" onSelect={onOutcome} />
    </div>
    {report.retained_visit_count === 0 && <p role="status">No retained visits match this range. Adjust the filters above to inspect another scope.</p>}
    <div className="grid gap-3 sm:grid-cols-2">
    <details className="workspace-disclosure"><summary>Exact daily chart data</summary><table className="w-full text-sm"><caption className="text-left">Retained Visit records · {report.scope.date_from} to {report.scope.date_to} · IST</caption><thead><tr><th scope="col">Date</th><th scope="col">Retained visits</th></tr></thead><tbody>{report.daily.map(row => <tr key={row.date}><th scope="row">{row.date}</th><td>{row.count.toLocaleString("en-IN")}</td></tr>)}</tbody></table></details>
    <details className="workspace-disclosure"><summary>Representative context · retained Visit authors</summary><p className="text-xs">Descriptive counts, not a performance ranking or the current employee roster. Select an immutable identity to apply it to the register, analysis and export.</p>
      {report.representatives ? <ul className="space-y-1">{report.representatives.map(row => <li key={row.user_id}><button type="button" className="min-h-11 text-left text-sm underline break-words" onClick={() => onRepresentative(row.user_id)}>{row.name || `Name unavailable · ${row.user_id}`} · {row.count.toLocaleString("en-IN")} retained visits</button><p className="break-all text-xs text-[var(--text-secondary)]">{row.user_id}</p></li>)}</ul> : <p role="status">Representative breakdown unavailable: more than 200 retained authors. Narrow the range.</p>}
    </details>
    </div>
    {report.date_mismatch_count > 0 && <p className="text-xs">{report.date_mismatch_count} retained records have a stored Visit date different from their IST check-in date. This chart uses the stored canonical Visit date.</p>}
  </section>;
}
