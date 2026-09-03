"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, Clock, Filter, Layers, Route } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegendContent, ChartTooltipContent } from "@/components/analytics/Chart";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
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
  const [historyMetric, setHistoryMetric] = useState<"activity" | "direction">("activity");
  const [sourceMetric, setSourceMetric] = useState<"rate" | "converted">("rate");
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setLoading(true); setError("");
      try {
        const { data } = await supabase.auth.getSession();
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
        setInspection(await response.json() as Inspection);
      } catch (reason) { if ((reason as Error).name !== "AbortError") setError(reason instanceof Error ? reason.message : "Pipeline inspection is unavailable."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [segment, stage, owner, source, search, stale, overdue, recentChange]);

  const stages = inspection?.stages ?? [];
  const sources = useMemo(() => (inspection?.sources ?? []).filter((row) => row.reconciled), [inspection]);
  const currentAge = inspection?.current_stage_age ?? [];
  const velocity = inspection?.historical_velocity.rows ?? [];
  const history = inspection?.history[historyWindow] ?? [];
  const needsAttention = inspection?.leads.filter((lead) => lead.attention_reasons.length).length ?? 0;

  if (loading && !inspection) return <section className="surface-panel grid min-h-[360px] place-items-center"><p className="text-[13px] font-medium text-[var(--text-muted)]">Loading pipeline inspection…</p></section>;
  if (error || !inspection) return <section className="surface-panel p-5"><EmptyState icon={<AlertTriangle size={20} />} title="Pipeline inspection unavailable" description={error || "Try again."} /></section>;

  return <div className="page-stack" aria-busy={loading}>
    <form className="surface-toolbar flex-wrap" onSubmit={(event) => { event.preventDefault(); setSearch(searchDraft.trim()); }}>
      <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--text-secondary)]"><Filter size={15} /> Server filters</div>
      <div className="segmented-control" aria-label="Pipeline segment filter">{(["All", "Retailer", "Distributor"] as const).map((value) => <button key={value} type="button" aria-pressed={segment === value} onClick={() => setSegment(value)}>{value}</button>)}</div>
      <select className="field-control min-w-40" aria-label="Owner" value={owner} onChange={(event) => setOwner(event.target.value)}><option value="">All owners</option>{inspection.owner_options.map((item) => <option key={item.user_id} value={item.user_id}>{item.name}</option>)}</select>
      <select className="field-control min-w-40" aria-label="Lead source" value={source} onChange={(event) => setSource(event.target.value)}><option value="">All sources</option>{sources.map((item) => <option key={item.source} value={item.source}>{item.source}</option>)}</select>
      <Input aria-label="Search pipeline" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Lead, person, phone or area" />
      <button className="btn-secondary" type="submit">Search</button>
      {[{ label: "Stale", value: stale, set: setStale }, { label: "Overdue task", value: overdue, set: setOverdue }, { label: "Recent change", value: recentChange, set: setRecentChange }].map((item) => <label key={item.label} className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={item.value} onChange={(event) => item.set(event.target.checked)} />{item.label}</label>)}
      <Chip variant="neutral" size="sm">{inspection.scope.matched_total} matching leads</Chip>
    </form>

    <div className="grid gap-4 md:grid-cols-3">
      <Metric label="Visible pipeline" value={stages.reduce((sum, row) => sum + row.count, 0)} detail="Server-authoritative stage counts" icon={<Route size={18} />} />
      <Metric label="Needs attention" value={needsAttention} detail={`Within this ${inspection.scope.page_size}-row inspection page`} icon={<AlertTriangle size={18} />} />
      <Metric label="Velocity sample" value={`n=${inspection.historical_velocity.sample_n}`} detail={`${inspection.historical_velocity.coverage_pct}% of eligible completed intervals`} icon={<Clock size={18} />} />
    </div>

    <div className="grid gap-5 xl:grid-cols-2">
      <ChartPanel kicker="Stage distribution" title="Canonical stage order" empty={!stages.length} emptyIcon={<Layers size={20} />}>
        <ChartContainer config={{ count: { label: "Leads", color: "var(--viz-primary)" } }} className="h-[340px]"><ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 620, height: 340 }}><BarChart data={stages} layout="vertical" margin={{ top: 8, right: 18, bottom: 8, left: 30 }} accessibilityLayer><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--viz-grid)" /><XAxis type="number" allowDecimals={false} axisLine={false} tickLine={false} /><YAxis type="category" dataKey="stage" width={104} axisLine={false} tickLine={false} /><Tooltip content={<ChartTooltipContent />} /><Bar dataKey="count" radius={[0, 5, 5, 0]} isAnimationActive={false}>{stages.map((row) => <Cell key={row.stage} fill={STAGE_COLORS[row.stage]} className="cursor-pointer" onClick={() => setStage((current) => current === row.stage ? "" : row.stage)} />)}</Bar></BarChart></ResponsiveContainer></ChartContainer>
      </ChartPanel>
      <ChartPanel kicker="Current stage age" title="Average current age by stage" empty={!currentAge.length} emptyIcon={<Clock size={20} />}>
        <ChartContainer config={{ average_days: { label: "Current age", color: "var(--viz-warning)" } }} className="h-[340px]"><ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 620, height: 340 }}><BarChart data={currentAge} layout="vertical" accessibilityLayer><CartesianGrid horizontal={false} stroke="var(--viz-grid)" /><XAxis type="number" /><YAxis type="category" dataKey="stage" width={104} /><Tooltip content={<ChartTooltipContent valueFormatter={(value) => `${value} days`} />} /><Bar dataKey="average_days" fill="var(--viz-warning)" radius={[0, 5, 5, 0]} isAnimationActive={false} /></BarChart></ResponsiveContainer></ChartContainer>
      </ChartPanel>
      <ChartPanel kicker="Completed intervals" title="Historical stage velocity" empty={!velocity.length} emptyIcon={<Clock size={20} />}>
        <ChartContainer config={{ p50_days: { label: "P50 days", color: "var(--viz-primary)" }, average_days: { label: "Average days", color: "var(--viz-info)" } }} className="h-[340px]"><ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 620, height: 340 }}><BarChart data={velocity} layout="vertical" accessibilityLayer><CartesianGrid horizontal={false} stroke="var(--viz-grid)" /><XAxis type="number" /><YAxis type="category" dataKey="stage" width={104} /><Tooltip content={<ChartTooltipContent valueFormatter={(value) => `${value} days`} />} /><Legend content={<ChartLegendContent />} /><Bar dataKey="p50_days" fill="var(--viz-primary)" isAnimationActive={false} /><Bar dataKey="average_days" fill="var(--viz-info)" isAnimationActive={false} /></BarChart></ResponsiveContainer></ChartContainer>
        <p className="mt-2 text-[10px] text-[var(--text-muted)]">Actual completed intervals · n={inspection.historical_velocity.sample_n} · coverage {inspection.historical_velocity.coverage_pct}%.</p>
      </ChartPanel>
      <ChartPanel kicker="Acquisition quality" title="Source conversion" empty={!sources.length} emptyIcon={<Activity size={20} />}>
        <div className="segmented-control mb-3" aria-label="Source conversion metric"><button type="button" aria-pressed={sourceMetric === "rate"} onClick={() => setSourceMetric("rate")}>Rate %</button><button type="button" aria-pressed={sourceMetric === "converted"} onClick={() => setSourceMetric("converted")}>Converted</button></div>
        <ChartContainer config={{ rate: { label: "Conversion rate", color: "var(--viz-success)" }, converted: { label: "Converted", color: "var(--viz-success)" } }} className="h-[340px]"><ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 620, height: 340 }}><BarChart data={sources} layout="vertical" accessibilityLayer><CartesianGrid horizontal={false} stroke="var(--viz-grid)" /><XAxis type="number" domain={sourceMetric === "rate" ? [0, 100] : undefined} /><YAxis type="category" dataKey="source" width={112} /><Tooltip content={<ChartTooltipContent valueFormatter={(value) => sourceMetric === "rate" ? `${value}%` : Number(value).toLocaleString("en-IN")} />} /><Bar dataKey={sourceMetric} fill="var(--viz-success)" radius={[0, 5, 5, 0]} isAnimationActive={false} /></BarChart></ResponsiveContainer></ChartContainer>
        <p className="mt-2 text-[10px] text-[var(--text-muted)]">{sources.map((row) => `${row.source}: ${row.converted}/${row.total}`).join(" · ")}</p>
      </ChartPanel>
    </div>

    <section className="surface-panel overflow-hidden" aria-labelledby="sales-history-title"><div className="flex flex-wrap items-center justify-between gap-3 border-b p-5"><div><p className="section-kicker">Real dated authority</p><h2 id="sales-history-title" className="mt-1 section-title">Sales review history</h2><p className="mt-1 text-[11px] text-[var(--text-muted)]">{inspection.history.coverage} Leads n={inspection.history.lead_sample_n}; transitions n={inspection.history.transition_sample_n}.</p></div><div className="flex flex-wrap gap-2"><div className="segmented-control" aria-label="History metric"><button type="button" aria-pressed={historyMetric === "activity"} onClick={() => setHistoryMetric("activity")}>Activity</button><button type="button" aria-pressed={historyMetric === "direction"} onClick={() => setHistoryMetric("direction")}>Direction</button></div><div className="segmented-control" aria-label="History window"><button type="button" aria-pressed={historyWindow === "weeks"} onClick={() => setHistoryWindow("weeks")}>12 weeks</button><button type="button" aria-pressed={historyWindow === "months"} onClick={() => setHistoryWindow("months")}>12 months</button></div></div></div><div className="p-4"><ChartContainer config={{ new_leads: { label: "New leads", color: "var(--viz-primary)" }, successes: { label: "Terminal successes", color: "var(--viz-success)" }, movements: { label: "Confirmed movements", color: "var(--viz-info)" }, advanced: { label: "Advanced", color: "var(--viz-success)" }, regressed: { label: "Regressed", color: "var(--viz-danger)" } }} className="h-[300px]"><ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 820, height: 300 }}><BarChart data={history} accessibilityLayer><CartesianGrid vertical={false} stroke="var(--viz-grid)" /><XAxis dataKey="period" /><YAxis allowDecimals={false} /><Tooltip content={<ChartTooltipContent />} /><Legend content={<ChartLegendContent />} />{historyMetric === "activity" ? <><Bar dataKey="new_leads" fill="var(--viz-primary)" isAnimationActive={false} /><Bar dataKey="successes" fill="var(--viz-success)" isAnimationActive={false} /><Bar dataKey="movements" fill="var(--viz-info)" isAnimationActive={false} /></> : <><Bar dataKey="advanced" fill="var(--viz-success)" isAnimationActive={false} /><Bar dataKey="regressed" fill="var(--viz-danger)" isAnimationActive={false} /></>}</BarChart></ResponsiveContainer></ChartContainer></div></section>

    <section className="data-table-shell" aria-labelledby="pipeline-inspection-title"><div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4"><div><p className="section-kicker">Exact operational context</p><h2 id="pipeline-inspection-title" className="mt-1 section-title">Pipeline inspection {stage ? `· ${stage}` : ""}</h2></div>{stage && <button type="button" className="btn-secondary" onClick={() => setStage("")}>Clear stage</button>}</div>{inspection.leads.length ? <div className="overflow-x-auto"><table className="min-w-[980px]"><thead><tr><th>Lead</th><th>Owner</th><th>Stage</th><th>Stage age</th><th>Reasons</th><th>Next task</th><th>Recent call</th></tr></thead><tbody>{inspection.leads.map((lead) => <tr key={lead.lead_id}><td><p className="font-semibold">{lead.business_name}</p><p className="text-[11px] text-[var(--text-muted)]">{lead.segment_type}</p></td><td>{lead.owner_name}</td><td><Chip variant={lead.attention_reasons.length ? "warning" : "neutral"} size="sm">{lead.status}</Chip></td><td>{lead.stage_age_days} days</td><td><div className="flex max-w-64 flex-wrap gap-1">{lead.attention_reasons.map((reason) => <Chip key={reason.code} variant={reason.code.includes("OVERDUE") || reason.code === "REGRESSED" ? "danger" : "neutral"} size="sm">{reason.text}</Chip>)}</div></td><td>{lead.next_task?.title ?? "—"}<small className="block">{lead.next_task?.due_date}</small></td><td>{lead.recent_call?.outcome ?? "—"}<small className="block">{lead.recent_call?.timestamp ? new Date(lead.recent_call.timestamp).toLocaleDateString("en-IN") : ""}</small></td></tr>)}</tbody></table></div> : <div className="p-5"><EmptyState compact icon={<Layers size={20} />} title="No matching leads" description="No leads match the authoritative server filters." /></div>}</section>
  </div>;
}

function Metric({ label, value, detail, icon }: { label: string; value: string | number; detail: string; icon: React.ReactNode }) { return <div className="surface-panel p-5"><div className="flex items-start justify-between gap-4"><div><p className="section-kicker">{label}</p><p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p><p className="mt-1 text-[12px] text-[var(--text-muted)]">{detail}</p></div><span className="grid h-10 w-10 place-items-center rounded-md bg-[var(--brand-50)] text-[var(--brand-700)]">{icon}</span></div></div>; }
function ChartPanel({ kicker, title, empty, emptyIcon, children }: { kicker: string; title: string; empty: boolean; emptyIcon: React.ReactNode; children: React.ReactNode }) { return <section className="surface-panel overflow-hidden"><div className="border-b p-5"><p className="section-kicker">{kicker}</p><h2 className="mt-1 section-title">{title}</h2></div><div className="p-4">{empty ? <EmptyState compact icon={emptyIcon} title="No data" description="No authoritative records match this selection." /> : children}</div></section>; }
