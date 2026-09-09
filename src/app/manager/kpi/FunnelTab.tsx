"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Line, LineChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltipContent } from "@/components/analytics/Chart";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { supabase } from "@/lib/supabaseClient";

type Segment = "All" | "Retailer" | "Distributor";
type HistoryPoint = { period: string; new_leads: number; successes: number; movements: number; advanced: number; regressed: number };
type InspectionLead = { lead_id: string; business_name: string; segment_type: string; status: string; owner_name: string; stage_age_days: number; attention_reasons: Array<{ code: string; text: string }>; next_task: { title?: string; due_date?: string } | null; recent_call: { outcome?: string; timestamp?: string } | null };
type Inspection = {
  scope: { page_size: number; matched_total: number; generated_at: string };
  stages: Array<{ stage: string; count: number }>;
  sources: Array<{ source: string; total: number; converted: number; rate: number; reconciled: boolean }>;
  current_stage_age: Array<{ stage: string; average_days: number }>;
  historical_velocity: { rows: Array<{ stage: string; p50_days: number; average_days: number; sample_n: number }>; sample_n: number; coverage_n: number; coverage_pct: number };
  history: { weeks: HistoryPoint[]; months: HistoryPoint[]; lead_sample_n: number; transition_sample_n: number; coverage: string; lead_sample_limited: boolean; transition_sample_limited: boolean };
  owner_options: Array<{ user_id: string; name: string }>;
  leads: InspectionLead[];
};

const STAGE_COLORS: Record<string, string> = { New: "var(--viz-muted)", Contacted: "var(--viz-info)", Interested: "var(--viz-primary)", "Not Interested": "var(--viz-danger)", Registration: "var(--viz-pending)", Installation: "var(--viz-success)", Payment: "var(--viz-warning)", Converted: "var(--viz-success-strong)", "Renewal Due": "var(--viz-pending)" };

export default function FunnelTab() {
  const [segment, setSegment] = useState<Segment>("All");
  const [stage, setStage] = useState("");
  const [owner, setOwner] = useState("");
  const [source, setSource] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [stale, setStale] = useState(false);
  const [overdue, setOverdue] = useState(false);
  const [recentChange, setRecentChange] = useState(false);
  const [historyWindow, setHistoryWindow] = useState<"weeks" | "months">("weeks");
  const [historyMetric, setHistoryMetric] = useState<keyof Omit<HistoryPoint, "period">>("new_leads");
  const [appliedSegment, setAppliedSegment] = useState<Segment>("All");
  const [appliedList, setAppliedList] = useState("");
  const [retry, setRetry] = useState(0);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setLoading(true); setError("");
      try {
        const { data } = await supabase.auth.getSession();
        if (controller.signal.aborted) return;
        if (!data.session?.access_token) throw new Error("Sign in again.");
        const query = new URLSearchParams();
        if (segment !== "All") query.set("segment", segment);
        if (stage) query.set("stage", stage);
        if (owner) query.set("owner", owner);
        if (source) query.set("source", source);
        if (search) query.set("search", search);
        if (stale) query.set("stale", "true");
        if (overdue) query.set("overdue", "true");
        if (recentChange) query.set("recentChange", "true");
        const response = await fetch(`/api/pipeline/inspection?${query}`, { headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Pipeline inspection is unavailable.");
        const result = await response.json() as Inspection;
        if (controller.signal.aborted) return;
        setInspection(result); setAppliedSegment(segment);
        setAppliedList([stage || "All stages", owner ? `Owner ${result.owner_options.find((item) => item.user_id === owner)?.name || owner}` : "All owners", source || "All sources", search ? `Search: ${search}` : "", stale ? "Stale" : "", overdue ? "Overdue task" : "", recentChange ? "Recent change" : ""].filter(Boolean).join(" · "));
      } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Pipeline inspection is unavailable."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [segment, stage, owner, source, search, stale, overdue, recentChange, retry]);

  const stages = inspection?.stages ?? [];
  const sources = useMemo(() => (inspection?.sources ?? []).filter((row) => row.reconciled), [inspection]);
  const currentAge = inspection?.current_stage_age ?? [];
  const velocity = inspection?.historical_velocity.rows ?? [];
  const history = inspection?.history[historyWindow] ?? [];
  const needsAttention = inspection?.leads.filter((lead) => lead.attention_reasons.length).length ?? 0;

  const metricLabels = { new_leads: "New leads", successes: "Terminal successes", movements: "Confirmed movements", advanced: "Advanced", regressed: "Regressed" };
  return <div className="space-y-4" aria-busy={loading}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="segmented-control" aria-label="Pipeline segment filter">{(["All", "Retailer", "Distributor"] as const).map((value) => <button key={value} type="button" aria-pressed={segment === value} onClick={() => setSegment(value)}>{value}</button>)}</div>
      <Button size="sm" variant="outline" disabled={loading} onClick={() => setRetry((value) => value + 1)}>Refresh inspection</Button>
    </div>
    {error && <p role="alert" className="alert-panel alert-panel--danger">{error} {inspection && "Previous applied report remains visible."}</p>}
    {loading && <p role="status" className="text-sm">Loading pipeline inspection…</p>}
    {inspection ? <>
      <p className="text-xs text-[var(--text-secondary)]">Applied analytics: {appliedSegment} segments · Refreshed {new Date(inspection.scope.generated_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST. List filters do not filter these analytics.</p>
      <section aria-label="Current stage occupancy" className="flex gap-2 overflow-x-auto pb-1">{stages.map((row) => <div key={row.stage} className="shrink-0 border-l-2 px-3 py-2" style={{ borderColor: STAGE_COLORS[row.stage] || "var(--viz-muted)" }}><p className="text-xs text-[var(--text-secondary)]">{row.stage}</p><p className="text-lg font-semibold tabular-nums">{row.count.toLocaleString("en-IN")}</p></div>)}</section>
      <div className="flex flex-col gap-4">
        <section className="space-y-3" aria-labelledby="pipeline-inspection-title">
          <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); setSearch(searchDraft.trim()); }}>
            <div className="flex flex-wrap items-center gap-3"><h2 id="pipeline-inspection-title" className="text-base font-semibold">Inspection register</h2>      <Input aria-label="Search pipeline" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Lead, person, phone or area" />
      <Button variant="secondary" type="submit">Search</Button>
</div>
            <details><summary className="cursor-pointer text-sm">Inspection-list filters only</summary><div className="grid gap-3 sm:grid-cols-3"><label className="text-sm">Stage<select aria-label="Stage" className="field-control" value={stage} onChange={(event) => setStage(event.target.value)}><option value="">All stages</option>{stages.map((row) => <option key={row.stage} value={row.stage}>{row.stage}</option>)}</select></label>      <select className="field-control min-w-0" aria-label="Owner" value={owner} onChange={(event) => setOwner(event.target.value)}><option value="">All owners</option>{inspection.owner_options.map((item) => <option key={item.user_id} value={item.user_id}>{item.name}</option>)}</select>
      <select className="field-control min-w-0" aria-label="Lead source" value={source} onChange={(event) => setSource(event.target.value)}><option value="">All sources</option>{sources.map((item) => <option key={item.source} value={item.source}>{item.source}</option>)}</select>
      {[{ label: "Stale", value: stale, set: setStale }, { label: "Overdue task", value: overdue, set: setOverdue }, { label: "Recent change", value: recentChange, set: setRecentChange }].map((item) => <label key={item.label} className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={item.value} onChange={(event) => item.set(event.target.checked)} />{item.label}</label>)}
</div></details>
          </form>
          <p className="text-xs text-[var(--text-secondary)]">Applied list: {appliedList} · {inspection.scope.matched_total} matches · {inspection.leads.length} of maximum {inspection.scope.page_size} loaded · {needsAttention} loaded records need attention.</p>
          <section className="workspace-register" data-workspace-register tabIndex={-1} aria-label="Pipeline inspection records"><ol className="divide-y divide-[var(--border-subtle)]">{inspection.leads.map((lead) => <li key={lead.lead_id} className="workspace-task-row"><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{lead.business_name}</p><p className="text-xs text-[var(--text-secondary)]">{lead.owner_name} · {lead.segment_type} · Current stage age {lead.stage_age_days} days</p><p className="text-xs">{lead.attention_reasons.map((reason) => reason.text).join(" · ") || "No attention reason in the retained context"}</p><details><summary className="cursor-pointer text-xs">Linked work</summary><p className="text-sm">Next task: {lead.next_task?.title || "None in context"} {lead.next_task?.due_date}</p><p className="text-sm">Latest call: {lead.recent_call?.outcome || "None in context"} {lead.recent_call?.timestamp ? new Date(lead.recent_call.timestamp).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) + " IST" : ""}</p></details></div><Chip variant={lead.attention_reasons.length ? "warning" : "neutral"} size="sm">{lead.status}</Chip></li>)}</ol>{!inspection.leads.length && <EmptyState title="No matching leads" description="Change the inspection-list filters; segment analytics remain separate." />}</section>
        </section>
        <section className="space-y-2 border-t border-[var(--border-subtle)] pt-3" aria-labelledby="sales-history-title">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="sales-history-title" className="text-base font-semibold">Pipeline event history</h2><div className="flex flex-wrap gap-3"><label className="flex items-center gap-2 text-sm">Event<select className="field-control" value={historyMetric} onChange={(event) => setHistoryMetric(event.target.value as typeof historyMetric)}>{Object.entries(metricLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><div className="segmented-control" aria-label="History window"><button type="button" aria-pressed={historyWindow === "weeks"} onClick={() => setHistoryWindow("weeks")}>12 weeks</button><button type="button" aria-pressed={historyWindow === "months"} onClick={() => setHistoryWindow("months")}>12 months</button></div></div></div>
          <p className="text-xs text-[var(--text-secondary)]">{inspection.history.coverage} Leads n={inspection.history.lead_sample_n}; transitions n={inspection.history.transition_sample_n}.{(inspection.history.lead_sample_limited || inspection.history.transition_sample_limited) && " Bounded sample; not complete activity coverage."}</p>
          {history.length ? <ChartContainer config={{ [historyMetric]: { label: metricLabels[historyMetric], color: "var(--viz-primary)" } }} className="h-[220px]" initialDimension={{ width: 820, height: 220 }}><LineChart data={history} accessibilityLayer margin={{ left: 0, right: 12, top: 8, bottom: 0 }}><CartesianGrid vertical={false} stroke="var(--viz-grid)" /><XAxis dataKey="period" minTickGap={25} tickLine={false} axisLine={false} /><YAxis allowDecimals={false} width={32} tickLine={false} axisLine={false} /><Tooltip content={<ChartTooltipContent />} /><Line dataKey={historyMetric} type="linear" connectNulls={false} stroke="var(--viz-primary)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} /></LineChart></ChartContainer> : <p className="p-4 text-sm">No retained event series available for this window.</p>}
          <details className="workspace-disclosure"><summary>Exact {metricLabels[historyMetric].toLowerCase()} series</summary><div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Pipeline event data"><table className="w-full"><caption className="text-left">{appliedSegment} · {historyWindow} · {metricLabels[historyMetric]}</caption><thead><tr><th>Period</th><th>{metricLabels[historyMetric]}</th></tr></thead><tbody>{history.map((row) => <tr key={row.period}><th scope="row">{row.period}</th><td>{row[historyMetric].toLocaleString("en-IN")}</td></tr>)}</tbody></table></div></details>
        </section>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <section className="workspace-register p-4"><h2 className="text-base font-semibold">Completed stage intervals</h2><p className="text-xs text-[var(--text-secondary)]">P50 and mean duration in days · n={inspection.historical_velocity.sample_n} · {inspection.historical_velocity.coverage_n} eligible intervals · {inspection.historical_velocity.coverage_pct}% covered</p><div className="overflow-auto" tabIndex={0} role="region" aria-label="Completed interval duration"><table className="w-full"><thead><tr><th>Stage</th><th>P50 days</th><th>Mean days</th><th>Sample n</th></tr></thead><tbody>{velocity.map((row) => <tr key={row.stage}><th scope="row">{row.stage}</th><td>{row.p50_days}</td><td>{row.average_days}</td><td>{row.sample_n}</td></tr>)}</tbody></table></div>{!velocity.length && <p>No completed intervals in the retained sample.</p>}<details><summary className="cursor-pointer text-sm">Current stage age · not duration</summary><dl>{currentAge.map((row) => <div key={row.stage} className="flex justify-between gap-3 text-sm"><dt>{row.stage}</dt><dd>{row.average_days} mean days</dd></div>)}</dl></details></section>
        <section className="workspace-register p-4"><h2 className="text-base font-semibold">Source conversion</h2><p className="text-xs text-[var(--text-secondary)]">Reconciled segment-wide source counts · Not filtered by inspection-list controls</p><div className="overflow-auto" tabIndex={0} role="region" aria-label="Source conversion data"><table className="w-full"><thead><tr><th>Source</th><th>Total</th><th>Converted</th><th>Rate</th></tr></thead><tbody>{sources.map((row) => <tr key={row.source}><th scope="row">{row.source}</th><td>{row.total.toLocaleString("en-IN")}</td><td>{row.converted.toLocaleString("en-IN")}</td><td>{row.total > 0 ? row.rate + "%" : "Unavailable"}</td></tr>)}</tbody></table></div>{!sources.length && <p>No reconciled source counts available.</p>}</section>
      </div>
    </> : !loading && <EmptyState icon={<AlertTriangle size={20} />} title="Pipeline inspection unavailable" description="Use Refresh inspection to retry." />}
  </div>;
}
