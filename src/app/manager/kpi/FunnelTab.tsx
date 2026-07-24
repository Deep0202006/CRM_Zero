"use client";

import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import { db } from "@/lib/db";
import { PIPELINE_STAGES } from "@/lib/pipelineStages";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
  FunnelChart,
  Funnel,
  LabelList,
} from "recharts";
import { Filter, Layers, Clock, Activity, Route, TrendingUp } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { Chip } from "@/components/ui/Chip";

interface FunnelSummary {
  segment_type: string;
  status: string;
  lead_count: number;
}

interface SourcePerformance {
  lead_source: string;
  segment_type: string;
  total_leads: number;
  converted: number;
  conversion_rate_pct: number;
}

interface AvgTimeInStage {
  status: string;
  segment_type: string;
  avg_days_in_current_stage: number;
}

export default function FunnelTab() {
  const [funnelData, setFunnelData] = useState<FunnelSummary[]>([]);
  const [sourceData, setSourceData] = useState<SourcePerformance[]>([]);
  const [timeData, setTimeData] = useState<AvgTimeInStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSegment, setActiveSegment] = useState<"All" | "Retailer" | "Distributor">("All");

  useEffect(() => {
    (async () => {
      setLoading(true);
      if (isSupabaseConfigured) {
        // Fetch from Supabase views
        const [funnelRes, sourceRes, timeRes] = await Promise.all([
          supabase.from("pipeline_funnel_summary").select("*"),
          supabase.from("lead_source_performance").select("*"),
          supabase.from("avg_time_in_stage").select("*"),
        ]);
        setFunnelData(funnelRes.data || []);
        setSourceData(sourceRes.data || []);
        setTimeData(timeRes.data || []);
      } else {
        // Build offline from Dexie
        const leads = await db.leads.toArray();
        
        // 1. Funnel Summary
        const funnelMap: Record<string, number> = {};
        leads.forEach(l => {
          const key = `${l.segment_type}|${l.status}`;
          funnelMap[key] = (funnelMap[key] || 0) + 1;
        });
        const localFunnel: FunnelSummary[] = Object.keys(funnelMap).map(k => {
          const [seg, status] = k.split("|");
          return { segment_type: seg, status, lead_count: funnelMap[k] };
        });

        // 2. Source Performance
        const sourceMap: Record<string, { total: number; converted: number }> = {};
        leads.forEach(l => {
          if (!l.lead_source) return;
          const key = `${l.lead_source}|${l.segment_type}`;
          if (!sourceMap[key]) sourceMap[key] = { total: 0, converted: 0 };
          sourceMap[key].total += 1;
          if (l.status === "Payment") sourceMap[key].converted += 1;
        });
        const localSource: SourcePerformance[] = Object.keys(sourceMap).map(k => {
          const [src, seg] = k.split("|");
          const { total, converted } = sourceMap[k];
          return {
            lead_source: src,
            segment_type: seg,
            total_leads: total,
            converted,
            conversion_rate_pct: total > 0 ? Math.round((converted / total) * 1000) / 10 : 0
          };
        });

        // 3. Avg Time in Stage
        const timeMap: Record<string, { sum: number; count: number }> = {};
        const now = Date.now();
        leads.forEach(l => {
          if (l.status === "Payment" || l.status === "Not Interested") return;
          const key = `${l.status}|${l.segment_type}`;
          if (!timeMap[key]) timeMap[key] = { sum: 0, count: 0 };
          const start = new Date(l.stage_entered_at || l.created_at).getTime();
          const days = (now - start) / 86400000;
          timeMap[key].sum += days;
          timeMap[key].count += 1;
        });
        const localTime: AvgTimeInStage[] = Object.keys(timeMap).map(k => {
          const [status, seg] = k.split("|");
          return {
            status,
            segment_type: seg,
            avg_days_in_current_stage: Math.round((timeMap[k].sum / timeMap[k].count) * 10) / 10
          };
        });

        setFunnelData(localFunnel);
        setSourceData(localSource);
        setTimeData(localTime);
      }
      setLoading(false);
    })();
  }, []);

  // Stage colours are semantic CSS variables so light and dark themes remain consistent.
  const COLORS: Record<string, string> = {
    "New": "var(--chart-2)",
    "Contacted": "var(--chart-3)",
    "Interested": "var(--brand-500)",
    "Not Interested": "var(--status-neutral)",
    "Registration": "var(--chart-4)",
    "Installation": "var(--status-success)",
    "Payment": "var(--brand-700)",
    "Renewal Due": "var(--status-danger)",
  };

  const currentFunnel = PIPELINE_STAGES.map(stage => {
    const leadsInStage = funnelData
      .filter(f => (activeSegment === "All" || f.segment_type === activeSegment) && f.status === stage)
      .reduce((sum, f) => sum + f.lead_count, 0);
    return { name: stage, value: leadsInStage, fill: COLORS[stage] || "var(--chart-5)" };
  }).filter(s => s.value > 0);

  const currentSource = sourceData
    .filter(s => activeSegment === "All" || s.segment_type === activeSegment)
    .reduce((acc, curr) => {
      const existing = acc.find(a => a.lead_source === curr.lead_source);
      if (existing) {
        existing.total_leads += curr.total_leads;
        existing.converted += curr.converted;
        existing.conversion_rate_pct = existing.total_leads > 0 
          ? Math.round((existing.converted / existing.total_leads) * 1000) / 10 
          : 0;
      } else {
        acc.push({ ...curr });
      }
      return acc;
    }, [] as SourcePerformance[])
    .sort((a, b) => b.total_leads - a.total_leads); // Rank by total leads

  const currentTime = PIPELINE_STAGES.filter((s: string) => s !== "Payment" && s !== "Not Interested").map((stage: string) => {
    const stageData = timeData
      .filter((t) => (activeSegment === "All" || t.segment_type === activeSegment) && t.status === stage);
    
    let avg = 0;
    if (stageData.length > 0) {
      avg = stageData.reduce((sum, t) => sum + t.avg_days_in_current_stage, 0) / stageData.length;
    }
    return { status: stage, avg_days: Math.round(avg * 10) / 10 };
  }).filter(t => t.avg_days > 0);

  const totalVisibleLeads = currentFunnel.reduce((sum, stage) => sum + stage.value, 0);
  const convertedVisibleLeads = currentSource.reduce((sum, source) => sum + source.converted, 0);
  const averageVisibleStageTime = currentTime.length ? Math.round((currentTime.reduce((sum, stage) => sum + stage.avg_days, 0) / currentTime.length) * 10) / 10 : 0;

  if (loading) {
    return <section className="surface-panel grid min-h-[360px] place-items-center"><p className="text-[13px] font-medium text-[var(--text-muted)]">Loading pipeline intelligence…</p></section>;
  }

  return (
    <div className="page-stack">
      <div className="surface-toolbar">
        <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--text-secondary)]"><Filter size={15} /> Segment</div>
        <div className="segmented-control" aria-label="Pipeline segment filter">
          {(["All", "Retailer", "Distributor"] as const).map((segment) => (
            <button key={segment} type="button" aria-pressed={activeSegment === segment} onClick={() => setActiveSegment(segment)}>{segment}</button>
          ))}
        </div>
        <div className="flex-1" />
        <Chip variant="neutral" size="sm">{totalVisibleLeads} active leads</Chip>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="surface-panel p-5"><div className="flex items-start justify-between gap-4"><div><p className="section-kicker">Visible pipeline</p><p className="mt-2 text-3xl font-semibold tracking-[-0.04em] tabular-nums">{totalVisibleLeads}</p><p className="mt-1 text-[12px] text-[var(--text-muted)]">Leads across active funnel stages</p></div><span className="grid h-10 w-10 place-items-center rounded-[var(--radius-md)] bg-[var(--brand-50)] text-[var(--brand-700)]"><Route size={18} /></span></div></div>
        <div className="surface-panel p-5"><div className="flex items-start justify-between gap-4"><div><p className="section-kicker">Converted</p><p className="mt-2 text-3xl font-semibold tracking-[-0.04em] tabular-nums">{convertedVisibleLeads}</p><p className="mt-1 text-[12px] text-[var(--text-muted)]">Leads reaching payment</p></div><span className="grid h-10 w-10 place-items-center rounded-[var(--radius-md)] bg-[var(--status-success-soft)] text-[var(--status-success)]"><TrendingUp size={18} /></span></div></div>
        <div className="surface-panel p-5"><div className="flex items-start justify-between gap-4"><div><p className="section-kicker">Average stage time</p><p className="mt-2 text-3xl font-semibold tracking-[-0.04em] tabular-nums">{averageVisibleStageTime}<span className="ml-1 text-sm font-medium text-[var(--text-muted)]">days</span></p><p className="mt-1 text-[12px] text-[var(--text-muted)]">Across active non-terminal stages</p></div><span className="grid h-10 w-10 place-items-center rounded-[var(--radius-md)] bg-[var(--status-warning-soft)] text-[var(--status-warning)]"><Clock size={18} /></span></div></div>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="surface-panel overflow-hidden" aria-labelledby="pipeline-funnel-title">
          <div className="border-b border-[var(--border-subtle)] p-5"><p className="section-kicker">Stage distribution</p><h2 id="pipeline-funnel-title" className="mt-1 section-title">Pipeline funnel</h2></div>
          <div className="h-[340px] p-4">
            {currentFunnel.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <FunnelChart margin={{ top: 18, right: 70, bottom: 18, left: 20 }}>
                  <Tooltip formatter={(value: unknown) => [`${value} leads`, "Count"]} contentStyle={{ backgroundColor: "var(--surface-elevated)", borderColor: "var(--border-default)", borderRadius: "10px", color: "var(--text-primary)", fontSize: "12px", boxShadow: "var(--shadow-popover)" }} />
                  <Funnel dataKey="value" data={currentFunnel} isAnimationActive={false}>
                    <LabelList position="center" fill="var(--brand-contrast)" stroke="none" dataKey="name" fontSize={11} fontWeight={700} />
                    <LabelList position="right" fill="var(--text-muted)" stroke="none" dataKey="value" formatter={(value: unknown) => `${value} leads`} fontSize={11} fontWeight={600} />
                  </Funnel>
                </FunnelChart>
              </ResponsiveContainer>
            ) : <EmptyState compact icon={<Layers size={20} />} title="No active funnel data" description="No leads match the selected segment." />}
          </div>
        </section>

        <section className="surface-panel overflow-hidden" aria-labelledby="stage-time-title">
          <div className="border-b border-[var(--border-subtle)] p-5"><p className="section-kicker">Pipeline velocity</p><h2 id="stage-time-title" className="mt-1 section-title">Average days in stage</h2></div>
          <div className="h-[340px] p-4">
            {currentTime.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={currentTime} margin={{ top: 18, right: 12, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
                  <XAxis dataKey="status" tick={{ fontSize: 10, fontWeight: 600, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fontWeight: 600, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(value: unknown) => [`${value} days`, "Average"]} cursor={{ fill: "var(--surface-hover)" }} contentStyle={{ backgroundColor: "var(--surface-elevated)", borderColor: "var(--border-default)", borderRadius: "10px", color: "var(--text-primary)", fontSize: "12px", boxShadow: "var(--shadow-popover)" }} />
                  <Bar dataKey="avg_days" radius={[5, 5, 0, 0]} maxBarSize={52} isAnimationActive={false}>
                    {currentTime.map((entry, index) => <Cell key={`${entry.status}-${index}`} fill={COLORS[entry.status] || "var(--chart-4)"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyState compact icon={<Clock size={20} />} title="No stage-time data" description="Stage velocity appears after leads spend time in active stages." />}
          </div>
        </section>
      </div>

      <section className="data-table-shell" aria-labelledby="source-performance-title">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-5 py-4"><div><p className="section-kicker">Acquisition quality</p><h2 id="source-performance-title" className="mt-1 section-title">Lead-source performance</h2></div><span className="grid h-9 w-9 place-items-center rounded-[var(--radius-md)] bg-[var(--status-success-soft)] text-[var(--status-success)]"><Activity size={17} /></span></div>
        {currentSource.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-[680px]">
              <thead><tr><th>Lead source</th><th>Total leads</th><th>Converted</th><th>Conversion rate</th></tr></thead>
              <tbody>
                {currentSource.map((source) => (
                  <tr key={source.lead_source}>
                    <td><p className="font-semibold text-[var(--text-primary)]">{source.lead_source}</p></td>
                    <td className="font-semibold tabular-nums">{source.total_leads}</td>
                    <td className="font-semibold tabular-nums text-[var(--status-success)]">{source.converted}</td>
                    <td><div className="flex min-w-[170px] items-center gap-3"><span className="w-12 text-right font-semibold tabular-nums text-[var(--text-primary)]">{source.conversion_rate_pct}%</span><div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--surface-tertiary)]"><div className="h-full rounded-full bg-[var(--status-success)]" style={{ width: `${Math.min(source.conversion_rate_pct, 100)}%` }} /></div></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="p-5"><EmptyState compact icon={<Activity size={20} />} title="No lead-source data" description="Source performance appears after lead records include acquisition sources." /></div>}
      </section>
    </div>
  );
}
