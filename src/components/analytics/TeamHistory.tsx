"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Area, AreaChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { addISTDateDays, getCurrentISTDate } from "@/lib/dateTime";
import { supabase } from "@/lib/supabaseClient";
import { HISTORY_METRICS, historyReportSchema, type HistoryMetric, type HistoryReport } from "@/lib/teamKpi/history";
import { Button } from "@/components/ui/Button";
import { MetricCard } from "@/components/ui/MetricCard";
import { ChartContainer, ChartTooltipContent } from "./Chart";
import { EmployeeDetailSheet } from "./EmployeeDetailSheet";

type Filters = { from: string; to: string; employee: string };
const display = (value: number | null) => value === null ? "Unavailable" : value.toLocaleString("en-IN");

export default function TeamHistory() {
  const [draft, setDraft] = useState<Filters>(() => ({ from: addISTDateDays(getCurrentISTDate(), -7), to: addISTDateDays(getCurrentISTDate(), -1), employee: "" }));
  const initial = useRef(draft);
  const [report, setReport] = useState<HistoryReport | null>(null);
  const [metric, setMetric] = useState<HistoryMetric>("calls_made");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);

  const load = useCallback(async (filters: Filters) => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setError(null);
    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (controller.signal.aborted) return;
      if (sessionError || !data.session?.access_token) throw new Error("Sign in again to load history.");
      const params = new URLSearchParams({ from: filters.from, to: filters.to, ...(filters.employee ? { employee: filters.employee } : {}) });
      const response = await fetch(`/api/team-kpi?${params}`, { headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: "no-store", signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body.message === "string" ? body.message : "History could not load.");
      const parsed = historyReportSchema.parse(body);
      if (parsed.scope.from !== filters.from || parsed.scope.to !== filters.to || (parsed.scope.employee ?? "") !== filters.employee) throw new Error("History returned a different scope. Retry.");
      if (!controller.signal.aborted) setReport(parsed);
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "History could not load.");
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, []);

  useEffect(() => { void load(initial.current); return () => pending.current?.abort(); }, [load]);
  const observed = metric === "calls_made";
  const appliedEmployee = report?.employees.find((row) => row.user_id === report.scope.employee);
  const dirty = report && (draft.from !== report.scope.from || draft.to !== report.scope.to || draft.employee !== (report.scope.employee ?? ""));
  return <div className="space-y-5">
    <form className="surface-panel space-y-3 p-4 sm:p-5" onSubmit={(event) => { event.preventDefault(); void load(draft); }}>
      <div className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_2fr_auto]">
        <label className="space-y-1 text-sm">From (IST)<input className="field-control w-full" type="date" required max={getCurrentISTDate()} value={draft.from} onChange={(event) => setDraft({ ...draft, from: event.target.value })} /></label>
        <label className="space-y-1 text-sm">Through (IST)<input className="field-control w-full" type="date" required max={getCurrentISTDate()} value={draft.to} onChange={(event) => setDraft({ ...draft, to: event.target.value })} /></label>
        <label className="space-y-1 text-sm">Employee scope<select className="field-control w-full" value={draft.employee} onChange={(event) => setDraft({ ...draft, employee: event.target.value })}><option value="">Whole current roster</option>{report?.employees.map((row) => <option key={row.user_id} value={row.user_id}>{row.name}</option>)}</select></label>
        <Button type="submit" disabled={loading}>Apply range</Button>
      </div>
      <p className="text-xs text-[var(--text-secondary)]">Up to 31 days, inclusive. Changes apply together; the register always retains the full current cohort.</p>
      {dirty && <p role="status" className="text-sm">Filters changed. The report still shows its previous applied scope.</p>}
    </form>
    {error && <p role="alert" className="alert-panel alert-panel--danger">{error} {report ? "Previous applied report remains visible." : "No report is available."}</p>}
    {loading && <p role="status">Loading retained observations… {report && "Previous applied report remains visible."}</p>}
    {report && <>
      <section className="surface-panel space-y-3 p-4 sm:p-5" aria-labelledby="history-scope-title">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="history-scope-title" className="section-title">{appliedEmployee?.name ?? "Whole current roster"} · {report.scope.from} to {report.scope.to}</h2><Button variant="outline" disabled={loading} onClick={() => void load({ from: report.scope.from, to: report.scope.to, employee: report.scope.employee ?? "" })}>Refresh history</Button></div>
        <p className="text-xs text-[var(--text-secondary)]">Last refreshed {new Date(report.generated_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST · {report.cohort.count} current internal roster members · Not historical membership</p>
        <p className="rounded-lg bg-[var(--status-warning-soft)] p-3 text-sm text-[var(--status-warning)]">Coverage uncertified. {report.coverage.reason}{report.coverage.partial_today && " Today is partial; its elapsed coverage is not comparable to a complete prior day."}</p>
        <label className="flex flex-wrap items-center gap-2 text-sm">Selected metric<select className="field-control" value={metric} onChange={(event) => setMetric(event.target.value as HistoryMetric)}>{Object.entries(HISTORY_METRICS).map(([key, item]) => <option key={key} value={key}>{item.label}{key !== "calls_made" ? " — unavailable" : ""}</option>)}</select></label>
        <p className="text-sm text-[var(--text-secondary)]">{HISTORY_METRICS[metric].reason}</p>
      </section>
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard label={HISTORY_METRICS[metric].label} value={observed ? display(report.totals.retained_calls) : "Unavailable"} tone="neutral" note="Applied scope · retained observations only" />
        <MetricCard label="Complete historical work" value="Unavailable" tone="neutral" note="No authoritative coverage watermark" />
        <MetricCard label="Own previous-period change" value="Unavailable" tone="neutral" note="Periods are not certified comparable" />
      </div>
      <section className="surface-panel space-y-3 p-4 sm:p-5" aria-labelledby="history-chart-title">
        <h2 id="history-chart-title" className="section-title">{HISTORY_METRICS[metric].label} by IST date</h2>
        <p className="text-xs text-[var(--text-secondary)]">{appliedEmployee?.name ?? "Whole current roster"}. Gaps mean no established activity value, not zero work. Exact retained counts are listed below.</p>
        {observed && report.coverage.source_read === "complete" ? <ChartContainer config={{ value: { label: "Observed retained calls", color: "var(--viz-primary)" } }} className="h-[320px] w-full" initialDimension={{ width: 640, height: 320 }}>
          <AreaChart data={report.daily} accessibilityLayer margin={{ left: 0, right: 16, top: 16, bottom: 8 }}>
            <CartesianGrid vertical={false} stroke="var(--viz-grid)" />
            <XAxis dataKey="date" tickFormatter={(date: string) => date.slice(5)} tick={{ fill: "var(--text-secondary)", fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis allowDecimals={false} domain={[0, "auto"]} tick={{ fill: "var(--text-secondary)", fontSize: 12 }} width={40} tickLine={false} axisLine={false} />
            <Tooltip filterNull={false} content={<ChartTooltipContent />} />
            <Area dataKey="value" type="linear" connectNulls={false} stroke="var(--viz-primary)" fill="var(--viz-primary)" fillOpacity={0.12} strokeWidth={2} dot={{ r: 4 }} isAnimationActive={false} />
          </AreaChart>
        </ChartContainer> : <p className="grid h-[320px] place-items-center text-sm">Chart unavailable. {observed ? report.coverage.reason : HISTORY_METRICS[metric].reason}</p>}
        <div className="data-table-shell max-h-[400px] overflow-auto" role="region" aria-label="History daily data" tabIndex={0} data-allow-overflow="horizontal">
          <table className="w-full min-w-[560px]"><caption className="p-3 text-left text-sm">{HISTORY_METRICS[metric].label}: selected and previous periods. Retained counts are not complete activity totals.</caption><thead><tr><th scope="col">IST date</th><th scope="col">Chart value</th><th scope="col">Retained count</th><th scope="col">Previous IST date</th><th scope="col">Previous retained count</th></tr></thead><tbody>{report.daily.map((point, index) => <tr key={point.date}><th scope="row">{point.date}</th><td>{observed && point.value !== null ? display(point.value) : "Gap / unavailable"}</td><td>{observed ? display(point.retained_calls) : "Unavailable"}</td><td>{report.previous_daily[index].date}</td><td>{observed ? display(report.previous_daily[index].retained_calls) : "Unavailable"}</td></tr>)}</tbody></table>
        </div>
      </section>
      <section className="data-table-shell" aria-labelledby="kpi-table-title">
        <div className="space-y-2 p-4 sm:p-5"><h2 id="kpi-table-title" tabIndex={-1} className="section-title">Employee history register</h2><p className="text-sm text-[var(--text-secondary)]">{HISTORY_METRICS[metric].label} · {report.scope.from} to {report.scope.to}. Full current roster, including selected employee. Descriptive observations, not a ranking.</p></div>
        <div className="max-h-[640px] overflow-auto" role="region" aria-label="Employee history register" tabIndex={0} data-allow-overflow="horizontal"><table className="w-full min-w-[680px]"><thead><tr><th scope="col">Employee</th><th scope="col">Current role</th><th scope="col">Selected period</th><th scope="col">Own previous period</th><th scope="col">Own change</th></tr></thead><tbody>{report.employees.map((row) => <tr key={row.user_id}><th scope="row"><button type="button" className="min-h-11 max-w-[240px] whitespace-normal break-words text-left underline underline-offset-4" onClick={(event) => { trigger.current = event.currentTarget; setSelectedId(row.user_id); }}>{row.name}</button></th><td className="max-w-[220px] whitespace-normal break-words">{row.role}</td><td>{observed ? display(row.retained_calls) : "Unavailable"}</td><td>{observed ? display(row.previous_retained_calls) : "Unavailable"}</td><td>Unavailable</td></tr>)}</tbody></table></div>
      </section>
      <EmployeeDetailSheet history={report} metric={metric} selectedId={selectedId} onClose={() => setSelectedId(null)} returnFocus={trigger} refreshing={loading} error={error} />
    </>}
  </div>;
}
