"use client";

// Adapted from Tremor CategoryBar at ca4d588f47820ff3d514d37fa4ee08a4222dec11.
// Apache-2.0; changed to semantic tokens and exact visible values. See TREMOR_LICENSE.
import type { AnalyticsMetric } from "@/lib/analytics/viewModels";

export function compositionReconciles(items: AnalyticsMetric[], total: number): boolean {
  return Number.isSafeInteger(total) && total >= 0 && items.every((item) => Number.isSafeInteger(item.value) && item.value >= 0) && items.reduce((sum, item) => sum + item.value, 0) === total;
}

export function CompositionStrip({ items, total, scope, onSelect }: { items: AnalyticsMetric[]; total: number; scope: string; onSelect?: (key: string) => void }) {
  if (!compositionReconciles(items, total)) return <p role="status">Composition unavailable: category values do not reconcile with the loaded records.</p>;
  const shown = items.filter((item) => item.value > 0);
  return <section aria-label="Outcome composition" className="space-y-2 border-t border-[var(--border-subtle)] pt-3">
    <p className="text-xs text-[var(--text-secondary)]">{scope} · Outcome composition, not a period trend</p>
    {total > 0 ? <div className="flex h-2 w-full overflow-hidden rounded-sm" aria-hidden="true">{shown.map((item) => <div key={item.key} style={{ width: `${item.value / total * 100}%`, backgroundColor: item.color }} />)}</div> : <p className="text-sm">No loaded visits to compose.</p>}
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">{shown.map((item) => <li key={item.key}>{onSelect && item.key !== "unknown" ? <button type="button" onClick={() => onSelect(item.key)} className="text-left underline underline-offset-4" aria-label={`Filter outcome: ${item.label}`}>{item.label} · {item.value.toLocaleString("en-IN")}</button> : <span>{item.label} · {item.value.toLocaleString("en-IN")}</span>}</li>)}</ul>
  </section>;
}
