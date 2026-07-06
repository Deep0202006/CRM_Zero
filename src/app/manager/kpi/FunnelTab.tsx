"use client";

import { useEffect, useState } from "react";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import { db } from "@/lib/db";
import { PIPELINE_STAGES } from "@/lib/pipelineRules";
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
import { Filter, Layers, Clock, Activity } from "lucide-react";

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

  // Prepare filtered data for rendering
  const COLORS: Record<string, string> = {
    "New": "#3b82f6",
    "Contacted": "#8b5cf6",
    "Interested": "#ec4899",
    "Not Interested": "#64748b",
    "Registration": "#f59e0b",
    "Installation": "#10b981",
    "Payment": "#059669",
    "Renewal Due": "#f43f5e"
  };

  const currentFunnel = PIPELINE_STAGES.map(stage => {
    const leadsInStage = funnelData
      .filter(f => (activeSegment === "All" || f.segment_type === activeSegment) && f.status === stage)
      .reduce((sum, f) => sum + f.lead_count, 0);
    return { name: stage, value: leadsInStage, fill: COLORS[stage] || "#94a3b8" };
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
      .filter((t: any) => (activeSegment === "All" || t.segment_type === activeSegment) && t.status === stage);
    
    let avg = 0;
    if (stageData.length > 0) {
      avg = stageData.reduce((sum, t) => sum + t.avg_days_in_current_stage, 0) / stageData.length;
    }
    return { status: stage, avg_days: Math.round(avg * 10) / 10 };
  }).filter(t => t.avg_days > 0);

  if (loading) {
    return (
      <div className="text-center py-16 text-slate-400 text-sm font-semibold animate-pulse">
        Loading Funnel Data...
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {/* Segment Filter */}
      <div className="flex items-center gap-2 mb-6">
        <Filter size={16} className="text-slate-400" />
        <span className="text-sm font-bold text-slate-700">Filter by Segment:</span>
        {(["All", "Retailer", "Distributor"] as const).map(seg => (
          <button
            key={seg}
            onClick={() => setActiveSegment(seg)}
            className={`px-4 py-1.5 rounded-full text-xs font-black transition-colors ${
              activeSegment === seg
                ? "bg-brand-primary text-white"
                : "bg-white text-slate-600 hover:bg-slate-50 border border-slate-200"
            }`}
          >
            {seg}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 w-full">
        {/* Pipeline Funnel Chart */}
        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 overflow-hidden">
          <div className="flex items-center gap-2 mb-6">
            <Layers size={18} className="text-brand-primary" />
            <h2 className="text-sm font-black text-slate-700">Pipeline Funnel Summary</h2>
          </div>
          {currentFunnel.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <FunnelChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                <Tooltip 
                  formatter={(value) => [`${value} Leads`, "Count"]}
                  contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12, fontWeight: 700 }}
                />
                <Funnel dataKey="value" data={currentFunnel} isAnimationActive>
                  <LabelList position="center" fill="#fff" stroke="none" dataKey="name" fontSize={12} fontWeight={800} />
                  <LabelList position="right" fill="#64748b" stroke="none" dataKey="value" formatter={(v: any) => `${v} leads`} fontSize={12} fontWeight={700} />
                </Funnel>
              </FunnelChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-slate-400 font-bold text-sm">
              No active leads in funnel.
            </div>
          )}
        </div>

        {/* Avg Time in Stage */}
        <div className="bg-white rounded-3xl border border-slate-100 shadow-sm p-6 overflow-hidden">
          <div className="flex items-center gap-2 mb-6">
            <Clock size={18} className="text-amber-500" />
            <h2 className="text-sm font-black text-slate-700">Average Time in Stage (Days)</h2>
          </div>
          {currentTime.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={currentTime} margin={{ top: 20, right: 20, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="status" tick={{ fontSize: 11, fontWeight: 700 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fontWeight: 700 }} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(v) => [`${v} days`, "Avg Time"]}
                  cursor={{ fill: '#f8fafc' }}
                  contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12, fontWeight: 700 }}
                />
                <Bar dataKey="avg_days" radius={[6, 6, 0, 0]} maxBarSize={60}>
                  {currentTime.map((entry: any, index: number) => (
                    <Cell key={index} fill={COLORS[entry.status as keyof typeof COLORS] || "#f59e0b"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
             <div className="h-[300px] flex items-center justify-center text-slate-400 font-bold text-sm">
             No time data available.
           </div>
          )}
        </div>
      </div>

      {/* Lead Source Performance */}
      <div className="bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden mt-6">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center gap-2">
          <Activity size={18} className="text-emerald-500" />
          <h2 className="text-sm font-black text-slate-700">Lead Source Performance</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-left">
                {["Lead Source", "Total Leads", "Converted to Payment", "Conversion Rate"].map((h) => (
                  <th key={h} className="px-6 py-3 text-[10px] font-black text-slate-400 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {currentSource.length > 0 ? currentSource.map((s, i) => (
                <tr key={s.lead_source} className="border-t border-slate-50 hover:bg-slate-50/50 transition-colors">
                  <td className="px-6 py-4 font-black text-slate-900">{s.lead_source}</td>
                  <td className="px-6 py-4 font-bold text-slate-600">{s.total_leads}</td>
                  <td className="px-6 py-4 font-bold text-emerald-600">{s.converted}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <span className="font-black text-slate-700 w-10">{s.conversion_rate_pct}%</span>
                      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden max-w-[100px]">
                        <div 
                          className="h-full bg-emerald-500 rounded-full" 
                          style={{ width: `${Math.min(s.conversion_rate_pct, 100)}%` }} 
                        />
                      </div>
                    </div>
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-sm font-bold text-slate-400">
                    No lead sources found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
