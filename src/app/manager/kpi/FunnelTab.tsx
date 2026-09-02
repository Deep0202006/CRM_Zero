"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, AlertTriangle, Clock, Filter, Layers, Route } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltipContent } from "@/components/analytics/Chart";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { supabase } from "@/lib/supabaseClient";

type Segment = "All" | "Retailer" | "Distributor";
type FunnelRow = { segment_type: string; status: string; lead_count: number };
type SourceRow = { lead_source: string; segment_type: string; total_leads: number; converted: number; conversion_rate_pct: number };
type VelocityRow = { status: string; segment_type: string; avg_days_in_current_stage: number };
type InspectionLead = {
  lead_id: string; business_name: string; segment_type: string; status: string; owner_name: string;
  stage_age_days: number; stale: boolean; attention: boolean;
  next_task: { title?: string; due_date?: string } | null;
  recent_call: { outcome?: string; timestamp?: string } | null;
};
type Inspection = {
  scope: { page_size: number; matched_total: number; generated_at: string };
  stages: FunnelRow[]; sources: SourceRow[]; velocity: VelocityRow[]; leads: InspectionLead[];
  growth: { weeks: Array<{ period: string; movements: number }>; months: Array<{ period: string; movements: number }>; sample_n: number; coverage: string };
};

const STAGE_COLORS: Record<string, string> = {
  New: "var(--chart-2)", Contacted: "var(--chart-3)", Interested: "var(--brand-500)",
  "Not Interested": "var(--status-neutral)", Registration: "var(--chart-4)",
  Installation: "var(--status-success)", Payment: "var(--brand-700)", Converted: "var(--status-success)",
};

export default function FunnelTab() {
  const [segment, setSegment] = useState<Segment>("All");
  const [selectedStage, setSelectedStage] = useState<string | null>(null);
  const [growthWindow, setGrowthWindow] = useState<"weeks" | "months">("weeks");
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      setLoading(true); setError(""); setSelectedStage(null);
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session?.access_token) throw new Error("Sign in again.");
        const query = segment === "All" ? "" : `?segment=${segment}`;
        const response = await fetch(`/api/pipeline/inspection${query}`, { headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Pipeline inspection is unavailable.");
        setInspection(await response.json() as Inspection);
      } catch (reason) {
        if ((reason as Error).name !== "AbortError") setError(reason instanceof Error ? reason.message : "Pipeline inspection is unavailable.");
      } finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [segment]);

  const stages = useMemo(() => {
    const rows = inspection?.stages.filter((row) => segment === "All" || row.segment_type === segment) ?? [];
    const totals = new Map<string, number>();
    rows.forEach((row) => totals.set(row.status, (totals.get(row.status) ?? 0) + row.lead_count));
    return [...totals].map(([stage, count]) => ({ stage, count })).sort((a, b) => b.count - a.count);
  }, [inspection, segment]);
  const velocity = useMemo(() => {
    const rows = inspection?.velocity.filter((row) => segment === "All" || row.segment_type === segment) ?? [];
    const grouped = new Map<string, number[]>();
    rows.forEach((row) => grouped.set(row.status, [...(grouped.get(row.status) ?? []), row.avg_days_in_current_stage]));
    return [...grouped].map(([stage, values]) => ({ stage, days: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10 })).sort((a, b) => b.days - a.days);
  }, [inspection, segment]);
  const sources = useMemo(() => {
    const grouped = new Map<string, { total: number; converted: number }>();
    (inspection?.sources ?? []).filter((row) => segment === "All" || row.segment_type === segment).forEach((row) => {
      const current = grouped.get(row.lead_source) ?? { total: 0, converted: 0 };
      grouped.set(row.lead_source, { total: current.total + row.total_leads, converted: current.converted + row.converted });
    });
    return [...grouped].map(([source, value]) => ({ source, ...value, rate: value.total ? Math.round(value.converted / value.total * 1000) / 10 : 0 })).sort((a, b) => b.total - a.total);
  }, [inspection, segment]);
  const visibleLeads = (inspection?.leads ?? []).filter((lead) => !selectedStage || lead.status === selectedStage);
  const averageDays = velocity.length ? Math.round(velocity.reduce((sum, row) => sum + row.days, 0) / velocity.length * 10) / 10 : 0;

  if (loading) return <section className="surface-panel grid min-h-[360px] place-items-center"><p className="text-[13px] font-medium text-[var(--text-muted)]">Loading pipeline inspection…</p></section>;
  if (error || !inspection) return <section className="surface-panel p-5"><EmptyState icon={<AlertTriangle size={20} />} title="Pipeline inspection unavailable" description={error || "Try again."} /></section>;

  return <div className="page-stack">
    <div className="surface-toolbar">
      <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--text-secondary)]"><Filter size={15} /> Segment</div>
      <div className="segmented-control" aria-label="Pipeline segment filter">{(["All", "Retailer", "Distributor"] as const).map((value) => <button key={value} type="button" aria-pressed={segment === value} onClick={() => setSegment(value)}>{value}</button>)}</div>
      <div className="flex-1" /><Chip variant="neutral" size="sm">{inspection.scope.matched_total} matching leads</Chip>
    </div>

    <div className="grid gap-4 md:grid-cols-3">
      <Metric label="Visible pipeline" value={stages.reduce((sum, row) => sum + row.count, 0)} detail="Server-authoritative stage counts" icon={<Route size={18} />} />
      <Metric label="Needs attention" value={inspection.leads.filter((lead) => lead.attention).length} detail={`Within this ${inspection.scope.page_size}-row inspection page`} icon={<AlertTriangle size={18} />} />
      <Metric label="Average current stage age" value={`${averageDays} days`} detail="Average of reported segment stage averages" icon={<Clock size={18} />} />
    </div>

    <div className="grid gap-5 xl:grid-cols-2">
      <ChartPanel kicker="Stage distribution" title="Ordered lead counts" empty={!stages.length} emptyIcon={<Layers size={20} />}>
        <ChartContainer config={{ count: { label: "Leads", color: "var(--brand-500)" } }} className="h-[340px]">
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 620, height: 340 }}>
          <BarChart data={stages} layout="vertical" margin={{ top: 8, right: 18, bottom: 8, left: 30 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border-subtle)" />
            <XAxis type="number" allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "var(--text-muted)" }} />
            <YAxis type="category" dataKey="stage" width={100} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "var(--text-muted)" }} />
            <Tooltip content={<ChartTooltipContent />} />
            <Bar dataKey="count" radius={[0, 5, 5, 0]} isAnimationActive={false}>{stages.map((row) => <Cell key={row.stage} fill={STAGE_COLORS[row.stage] ?? "var(--chart-5)"} className="cursor-pointer" onClick={() => setSelectedStage((current) => current === row.stage ? null : row.stage)} />)}</Bar>
          </BarChart>
          </ResponsiveContainer>
        </ChartContainer>
      </ChartPanel>
      <ChartPanel kicker="Current stage age" title="Average days by stage" empty={!velocity.length} emptyIcon={<Clock size={20} />}>
        <ChartContainer config={{ days: { label: "Average days", color: "var(--status-warning)" } }} className="h-[340px]">
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 620, height: 340 }}>
          <BarChart data={velocity} layout="vertical" margin={{ top: 8, right: 18, bottom: 8, left: 30 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border-subtle)" />
            <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "var(--text-muted)" }} />
            <YAxis type="category" dataKey="stage" width={100} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "var(--text-muted)" }} />
            <Tooltip content={<ChartTooltipContent valueFormatter={(value) => `${value} days`} />} />
            <Bar dataKey="days" fill="var(--status-warning)" radius={[0, 5, 5, 0]} isAnimationActive={false} />
          </BarChart>
          </ResponsiveContainer>
        </ChartContainer>
      </ChartPanel>
    </div>

    <section className="surface-panel overflow-hidden" aria-labelledby="pipeline-growth-title"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] p-5"><div><p className="section-kicker">Real confirmed history</p><h2 id="pipeline-growth-title" className="mt-1 section-title">Stage movement</h2><p className="mt-1 text-[11px] text-[var(--text-muted)]">{inspection.growth.coverage} · n={inspection.growth.sample_n}. Missing periods are not invented as zeroes.</p></div><div className="segmented-control" aria-label="Growth window"><button type="button" aria-pressed={growthWindow === "weeks"} onClick={() => setGrowthWindow("weeks")}>12 weeks</button><button type="button" aria-pressed={growthWindow === "months"} onClick={() => setGrowthWindow("months")}>12 months</button></div></div><div className="p-4">{inspection.growth[growthWindow].length ? <ChartContainer config={{ movements: { label: "Confirmed movements", color: "var(--brand-500)" } }} className="h-[280px]"><ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 820, height: 280 }}><LineChart data={inspection.growth[growthWindow]} margin={{ top: 12, right: 20, bottom: 8, left: -8 }}><CartesianGrid vertical={false} stroke="var(--border-subtle)" strokeDasharray="4 5" /><XAxis dataKey="period" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "var(--text-muted)" }} /><YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "var(--text-muted)" }} /><Tooltip content={<ChartTooltipContent />} /><Line type="linear" dataKey="movements" stroke="var(--brand-500)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} /></LineChart></ResponsiveContainer></ChartContainer> : <EmptyState compact icon={<Activity size={20} />} title="No confirmed movement in this window" description="The bounded transition sample contains no real points for the selected window." />}</div></section>

    <section className="data-table-shell" aria-labelledby="pipeline-inspection-title">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-4"><div><p className="section-kicker">Exact operational context</p><h2 id="pipeline-inspection-title" className="mt-1 section-title">Pipeline inspection {selectedStage ? `· ${selectedStage}` : ""}</h2></div>{selectedStage && <button type="button" className="btn-secondary" onClick={() => setSelectedStage(null)}>Clear stage</button>}</div>
      {visibleLeads.length ? <div className="overflow-x-auto"><table className="min-w-[880px]"><thead><tr><th>Lead</th><th>Owner</th><th>Stage</th><th>Stage age</th><th>Next task</th><th>Recent call</th></tr></thead><tbody>{visibleLeads.map((lead) => <tr key={lead.lead_id}><td><p className="font-semibold text-[var(--text-primary)]">{lead.business_name}</p><p className="text-[11px] text-[var(--text-muted)]">{lead.segment_type}</p></td><td>{lead.owner_name}</td><td><Chip variant={lead.attention ? "warning" : "neutral"} size="sm">{lead.status}</Chip></td><td className="tabular-nums">{lead.stage_age_days} days</td><td>{lead.next_task?.title ? <><p>{lead.next_task.title}</p><p className="text-[11px] text-[var(--text-muted)]">{lead.next_task.due_date}</p></> : "—"}</td><td>{lead.recent_call?.outcome ? <><p>{lead.recent_call.outcome}</p><p className="text-[11px] text-[var(--text-muted)]">{lead.recent_call.timestamp ? new Date(lead.recent_call.timestamp).toLocaleDateString() : ""}</p></> : "—"}</td></tr>)}</tbody></table></div> : <div className="p-5"><EmptyState compact icon={<Layers size={20} />} title="No matching leads" description="No leads in this bounded inspection page match the selected stage." /></div>}
    </section>

    <section className="data-table-shell" aria-labelledby="source-performance-title">
      <div className="border-b border-[var(--border-subtle)] px-5 py-4"><p className="section-kicker">Acquisition quality</p><h2 id="source-performance-title" className="mt-1 section-title">Lead-source performance</h2></div>
      {sources.length ? <div className="overflow-x-auto"><table className="min-w-[680px]"><thead><tr><th>Lead source</th><th>Sample</th><th>Converted</th><th>Conversion rate</th></tr></thead><tbody>{sources.map((row) => <tr key={row.source}><td className="font-semibold">{row.source}</td><td className="tabular-nums">n={row.total}</td><td className="tabular-nums">{row.converted}</td><td className="tabular-nums">{row.rate}%</td></tr>)}</tbody></table></div> : <div className="p-5"><EmptyState compact icon={<Activity size={20} />} title="No lead-source data" description="Source performance appears when lead records include acquisition sources." /></div>}
    </section>
  </div>;
}

function Metric({ label, value, detail, icon }: { label: string; value: string | number; detail: string; icon: React.ReactNode }) {
  return <div className="surface-panel p-5"><div className="flex items-start justify-between gap-4"><div><p className="section-kicker">{label}</p><p className="mt-2 text-3xl font-semibold tracking-[-0.04em] tabular-nums">{value}</p><p className="mt-1 text-[12px] text-[var(--text-muted)]">{detail}</p></div><span className="grid h-10 w-10 place-items-center rounded-[var(--radius-md)] bg-[var(--brand-50)] text-[var(--brand-700)]">{icon}</span></div></div>;
}

function ChartPanel({ kicker, title, empty, emptyIcon, children }: { kicker: string; title: string; empty: boolean; emptyIcon: React.ReactNode; children: React.ReactNode }) {
  return <section className="surface-panel overflow-hidden"><div className="border-b border-[var(--border-subtle)] p-5"><p className="section-kicker">{kicker}</p><h2 className="mt-1 section-title">{title}</h2></div><div className="p-4">{empty ? <EmptyState compact icon={emptyIcon} title="No data" description="No records match the selected segment." /> : children}</div></section>;
}
