"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { addISTDateDays, getCurrentISTDate } from "@/lib/dateTime";
import { supabase } from "@/lib/supabaseClient";
import { historyReportSchema, type HistoryReport } from "@/lib/teamKpi/history";
import { RETAINED_METRICS, retainedChangeLabel, type RetainedMetric } from "@/lib/teamKpi/retainedHistory";
import { Button } from "@/components/ui/Button";
import { EmployeeDetailSheet } from "./EmployeeDetailSheet";
import { RetainedHistoryChart } from "./RetainedHistoryChart";

type Filters = { from: string; to: string; employee: string; metric: RetainedMetric };
const display = (value: number | null) => value?.toLocaleString("en-IN") ?? "Unavailable";

export default function TeamHistory({ self = false }: { self?: boolean }) {
  const { currentUser } = useAuth(), actorId = currentUser?.user_id;
  const [draft, setDraft] = useState<Filters>(() => ({ from: addISTDateDays(getCurrentISTDate(), -7), to: addISTDateDays(getCurrentISTDate(), -1), employee: "", metric: "calls_made" }));
  const initial = useRef(draft);
  const [report, setReport] = useState<HistoryReport | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const load = useCallback(async (filters: Filters) => {
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    setLoading(true); setError(null);
    const timer = setTimeout(() => {
      if (pending.current !== controller) return;
      setError("History took too long. Retry the applied range or choose a narrower range.");
      setLoading(false); controller.abort();
    }, 12000);
    controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (controller.signal.aborted) return;
      if (sessionError || !data.session?.access_token || data.session.user.id !== actorId) throw new Error("Sign in again to load history.");
      const params = new URLSearchParams({ from: filters.from, to: filters.to, metric: filters.metric, ...(!self && filters.employee ? { employee: filters.employee } : {}) });
      const response = await fetch(`${self ? "/api/my-day/history" : "/api/team-kpi"}?${params}`, { headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: "no-store", signal: controller.signal });
      const body = await response.json();
      if (!response.ok) throw new Error(typeof body.message === "string" ? body.message : "History could not load.");
      const parsed = historyReportSchema.parse(body);
      if (parsed.kind !== (self ? "self-history-v1" : "team-history-v1") || parsed.scope.from !== filters.from || parsed.scope.to !== filters.to
        || parsed.scope.metric !== filters.metric || (parsed.scope.employee ?? "") !== filters.employee
        || (self && parsed.cohort.members[0] !== actorId)) throw new Error("History returned a different scope. Retry.");
      if (!controller.signal.aborted) setReport(parsed);
    } catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "History could not load."); }
    finally { clearTimeout(timer); if (!controller.signal.aborted) setLoading(false); }
  }, [actorId, self]);
  useEffect(() => { void load(initial.current); return () => pending.current?.abort(); }, [load]);
  const appliedEmployee = report?.employees.find(row => row.user_id === report.scope.employee);
  const dirty = report && (draft.from !== report.scope.from || draft.to !== report.scope.to || draft.employee !== (report.scope.employee ?? "") || draft.metric !== report.scope.metric);
  const retained = report?.retained_record_history;
  const scopeLabel = self ? "Your confirmed records" : appliedEmployee?.name ?? "Whole current roster";
  return <div className="space-y-3">
    <Button variant="outline" size="sm" className="xl:hidden" aria-expanded={showFilters} aria-controls="history-filters" onClick={() => setShowFilters(value => !value)}>{showFilters ? "Hide filters" : "Change range or metric"}</Button>
    <form id="history-filters" className={`${showFilters ? "block" : "hidden xl:block"} space-y-2`} onSubmit={event => { event.preventDefault(); void load(draft); }}>
      <div className="grid grid-cols-2 items-end gap-2 xl:grid-cols-5">
        <label className="text-sm">From (IST)<input className="field-control w-full" type="date" required max={getCurrentISTDate()} value={draft.from} onChange={event => setDraft({ ...draft, from: event.target.value })} /></label>
        <label className="text-sm">Through (IST)<input className="field-control w-full" type="date" required max={getCurrentISTDate()} value={draft.to} onChange={event => setDraft({ ...draft, to: event.target.value })} /></label>
        <label className="text-sm">Record type<select className="field-control w-full" value={draft.metric} onChange={event => setDraft({ ...draft, metric: event.target.value as RetainedMetric })}>{Object.entries(RETAINED_METRICS).filter(([key]) => !self || key !== "mappings_completed").map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></label>
        {!self && <label className="text-sm">Employee scope<select className="field-control w-full" value={draft.employee} onChange={event => setDraft({ ...draft, employee: event.target.value })}><option value="">Whole current roster</option>{report?.employees.map(row => <option key={row.user_id} value={row.user_id}>{row.name}</option>)}</select></label>}
        <Button type="submit" disabled={loading}>Apply range</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2"><span className="text-xs">Up to 31 days.</span>{[7, 30].map(days => <Button key={days} size="sm" variant="ghost" onClick={() => setDraft({ ...draft, from: addISTDateDays(getCurrentISTDate(), -days), to: addISTDateDays(getCurrentISTDate(), -1) })}>Last {days} closed days</Button>)}</div>
      {dirty && <p role="status" className="text-xs">Filters changed. The report still shows its previous applied scope.</p>}
    </form>
    {error && <p role="alert" className="alert-panel alert-panel--danger">{error} {report ? "Previous applied report remains visible." : "No report is available."}</p>}
    {error && !report && <Button size="sm" variant="outline" disabled={loading} onClick={() => void load(initial.current)}>Retry history</Button>}
    {loading && <p role="status">Loading retained observations… {report && "Previous applied report remains visible."}</p>}
    {report && retained && <>
      <header className="space-y-1"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="section-title text-balance">{scopeLabel} · {report.scope.from} to {report.scope.to}</h2><Button size="sm" variant="outline" disabled={loading} onClick={() => void load({ from: report.scope.from, to: report.scope.to, employee: report.scope.employee ?? "", metric: retained.metric })}>Refresh history</Button></div>
        <p className="text-sm tabular-nums"><strong>{display(retained.current)}</strong> {RETAINED_METRICS[retained.metric].label} · Own previous period: {display(retained.previous)} · {retainedChangeLabel(retained.comparison, retained.previous)}</p>
        <p className="text-xs text-[var(--text-secondary)]">Updated {new Date(report.generated_at).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })} IST · {retained.source_read === "exhausted" ? "Retained records, capture uncertified" : "Source unavailable"}{report.coverage.partial_today ? " · Today is partial" : ""}</p>
      </header>
      <div className="workspace-columns"><div className="min-w-0 space-y-3">
        <RetainedHistoryChart from={report.scope.from} previousFrom={report.scope.previous_from} values={retained.daily} previousValues={retained.previous_daily} label={RETAINED_METRICS[retained.metric].label} scope={scopeLabel} />
        {!self && <section className="data-table-shell" aria-label="Employee history register"><div className="p-3"><h2 data-workspace-register tabIndex={-1} className="section-title">Employee history register</h2><p className="text-xs">{report.cohort.count} current internal roster members · Own comparable retained-record change first. Current cohort context is descriptive, not historical membership or a ranking.</p></div>
          <div className="max-h-96 overflow-auto" role="region" aria-label="Employee history register" tabIndex={0} data-allow-overflow="horizontal"><table className="w-full min-w-[640px] text-sm tabular-nums"><thead><tr><th scope="col">Employee</th><th scope="col">Selected period</th><th scope="col">Own previous period</th><th scope="col">Own retained-record change</th></tr></thead><tbody>{report.employees.map((row, index) => { const values = retained.employees[index]; return <tr key={row.user_id}><th scope="row"><button type="button" className="min-h-11 max-w-60 break-words text-left underline" onClick={event => { trigger.current = event.currentTarget; setSelectedId(row.user_id); }}>{row.name}</button><p className="text-xs font-normal">{row.role}</p></th><td>{display(values.current)}</td><td>{display(values.previous)}</td><td className="max-w-60 whitespace-normal">{retainedChangeLabel(values.comparison, values.previous)}</td></tr>; })}</tbody></table></div>
        </section>}
        <details className="workspace-disclosure"><summary>Data availability and comparison limits</summary><p>{RETAINED_METRICS[retained.metric].meaning}</p><p>{report.coverage.reason}</p><p>Retained-record count change is not complete-work or productivity growth. Both closed periods must exhaust the same source and reference scope. Prior zero has no percentage. Historical task/target credit, query resolution, combined unique work, reached calls and revenue remain unavailable.</p>{self && <p>Only your verified server records are included. Offline pending work remains in Agenda and is not counted here.</p>}</details>
      </div>{!self && <EmployeeDetailSheet history={report} metric={retained.metric} selectedId={selectedId} onClose={() => setSelectedId(null)} returnFocus={trigger} refreshing={loading} error={error} />}</div>
    </>}
  </div>;
}
