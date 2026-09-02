"use client";

import { createContext, useContext, useId, type CSSProperties, type ReactNode } from "react";

export type ChartConfig = Record<string, { label: string; color: string }>;

const ChartContext = createContext<ChartConfig>({});

export function ChartContainer({ config, className = "", children }: { config: ChartConfig; className?: string; children: ReactNode }) {
  const id = useId().replace(/:/g, "");
  const style = Object.fromEntries(Object.entries(config).map(([key, value]) => [`--chart-${key}`, value.color])) as CSSProperties;
  return <ChartContext.Provider value={config}><div data-chart={id} data-chart-height="stable" className={`min-w-0 ${className}`} style={style}>{children}</div></ChartContext.Provider>;
}

type TooltipItem = { dataKey?: string | number; name?: string | number; value?: string | number; color?: string; payload?: Record<string, unknown> };

export function ChartTooltipContent({ active, payload, label, valueFormatter = (value) => Number(value).toLocaleString("en-IN") }: { active?: boolean; payload?: readonly TooltipItem[]; label?: ReactNode; valueFormatter?: (value: string | number, item: TooltipItem) => ReactNode }) {
  const config = useContext(ChartContext);
  if (!active || !payload?.length) return null;
  return <div className="min-w-36 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-elevated)] p-2.5 text-[11px] shadow-[var(--shadow-popover)]">
    {label != null && <p className="mb-1.5 font-semibold text-[var(--text-primary)]">{label}</p>}
    <div className="space-y-1.5">{payload.map((item, index) => { const key = String(item.dataKey ?? item.name ?? index); const entry = config[key]; return <div key={`${key}-${index}`} className="flex items-center justify-between gap-4"><span className="flex items-center gap-2 text-[var(--text-secondary)]"><span className="h-2 w-2 rounded-sm" style={{ background: item.color ?? entry?.color }} />{entry?.label ?? String(item.name ?? key)}</span><strong className="tabular-nums text-[var(--text-primary)]">{valueFormatter(item.value ?? 0, item)}</strong></div>; })}</div>
  </div>;
}

export function ChartLegendContent({ payload }: { payload?: ReadonlyArray<{ dataKey?: string | number; value?: string | number; color?: string }> }) {
  const config = useContext(ChartContext);
  if (!payload?.length) return null;
  return <div className="flex flex-wrap justify-center gap-3 pt-2 text-[11px] text-[var(--text-secondary)]">{payload.map((item, index) => { const key = String(item.dataKey ?? item.value ?? index); return <span key={`${key}-${index}`} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: item.color ?? config[key]?.color }} />{config[key]?.label ?? item.value}</span>; })}</div>;
}
