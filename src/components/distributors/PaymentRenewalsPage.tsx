"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import type { RenewalFilter, RenewalListRow, RenewalMetrics } from "@/lib/distributors/types";
import { renewalLabel } from "@/lib/distributors/domain";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { RenewalEditorModal } from "@/components/distributors/RenewalEditorModal";

const cards: ReadonlyArray<{ label: string; key: keyof RenewalMetrics; filter: RenewalFilter }> = [
  { label: "Overdue", key: "overdue", filter: "overdue" },
  { label: "Due Today", key: "today", filter: "today" },
  { label: "Tomorrow", key: "tomorrow", filter: "tomorrow" },
  { label: "In 2 Days", key: "in_two_days", filter: "in_two_days" },
];

const filters: ReadonlyArray<{ label: string; value: RenewalFilter }> = [
  { label: "All", value: "all" }, { label: "Overdue", value: "overdue" },
  { label: "Due Today", value: "today" }, { label: "Tomorrow", value: "tomorrow" },
  { label: "In 2 Days", value: "in_two_days" }, { label: "Upcoming", value: "upcoming" },
  { label: "Not Set", value: "not_set" },
];

export function PaymentRenewalsPage({ admin }: { admin: boolean }) {
  const { isAdmin } = useAuth();
  const [metrics, setMetrics] = useState<RenewalMetrics | null>(null);
  const [rows, setRows] = useState<RenewalListRow[]>([]);
  const [filter, setFilter] = useState<RenewalFilter>("all");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [metricsError, setMetricsError] = useState("");
  const [listError, setListError] = useState("");
  const [message, setMessage] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const authFetch = useCallback(async (url: string, init?: RequestInit) => {
    const { data } = await supabase.auth.getSession();
    if (!data.session?.access_token) throw new Error("Sign in again.");
    return fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers, Authorization: `Bearer ${data.session.access_token}` }, cache: "no-store" });
  }, []);
  const listUrl = useMemo(() => `/api/distributors/renewals?view=list&filter=${filter}&page=${page}&pageSize=50`, [filter, page]);

  const readJson = useCallback(async (response: Response) => {
    const result = await response.json();
    if (!response.ok) throw new Error(response.status === 403 ? "You are not authorized to view these renewals." : result.message ?? "Unable to load renewals.");
    return result;
  }, []);
  const loadList = useCallback(async () => {
    const result = await readJson(await authFetch(listUrl));
    setRows(result.rows ?? []); setTotal(result.total ?? 0);
  }, [authFetch, listUrl, readJson]);
  const loadMetrics = useCallback(async () => {
    const result = await readJson(await authFetch("/api/distributors/renewals?view=metrics"));
    setMetrics(result.metrics);
  }, [authFetch, readJson]);

  useEffect(() => {
    if (admin && !isAdmin) return;
    let active = true;
    const timer = window.setTimeout(() => { setMetricsError(""); void loadMetrics().catch((cause) => { if (active) setMetricsError(cause instanceof Error ? cause.message : "Unable to load renewal metrics."); }); }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [admin, isAdmin, loadMetrics]);
  useEffect(() => {
    if (admin && !isAdmin) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true); setListError("");
      void loadList().catch((cause) => { if (active) setListError(cause instanceof Error ? cause.message : "Unable to load renewals."); }).finally(() => { if (active) setLoading(false); });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [admin, isAdmin, loadList]);

  if (admin && !isAdmin) return <div className="app-page"><PageHeader title="Renewals" description="System Administrator access required." /></div>;
  return <div className="app-page">
    <PageHeader eyebrow="Payment Collection" icon={<CalendarDays size={16}/>} title="Renewals" description="Operational renewal dates from the canonical distributor authority." />
    {message && <div className="alert-panel alert-panel--info" role="status">{message}</div>}
    {metricsError && <div className="alert-panel alert-panel--danger" role="alert">Unable to load renewal metrics. {metricsError}</div>}
    {listError && <div className="alert-panel alert-panel--danger" role="alert">Unable to load renewals. {listError}</div>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(card => <button type="button" key={card.key} aria-pressed={filter === card.filter} className={`surface-panel p-4 text-left ${filter === card.filter ? "ring-2 ring-[var(--brand-500)]" : ""}`} onClick={() => { setFilter(card.filter); setPage(1); }}>
        <p className="text-[10px] font-semibold uppercase text-[var(--text-muted)]">{card.label}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{metrics?.[card.key] ?? "—"}</p>
      </button>)}
    </div>
    <section className="surface-panel overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 p-4"><label className="text-xs font-semibold">Renewal status<select aria-label="Renewal status" className="field-control ml-2" value={filter} onChange={event => { setFilter(event.target.value as RenewalFilter); setPage(1); }}>{filters.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label></div>
      {loading ? <p className="p-6 text-sm text-[var(--text-muted)]">Loading renewals…</p> : !listError && !metricsError && rows.length === 0 ? <p className="p-6 text-sm text-[var(--text-muted)]">{filter === "all" ? "No renewal dates set yet." : "No renewals match this filter."}</p> : !listError && rows.length > 0 && <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-xs"><thead><tr>{["Distributor", "Assigned Employee", "Renewal Date", "Renewal Status", "Action"].map(label => <th className="p-3" key={label}>{label}</th>)}</tr></thead><tbody>{rows.map(row => <tr className="border-t" key={row.distributor_id}><td className="p-3 font-semibold">{row.distributor_name}</td><td className="p-3">{row.assigned_employee_name}</td><td className="p-3">{row.renewal_date ?? "Not set"}</td><td className="p-3"><Chip variant={row.renewal_state === "renewal_overdue" ? "danger" : row.renewal_state.includes("due") ? "warning" : "neutral"}>{renewalLabel(row.renewal_state)}</Chip></td><td className="p-3"><Button variant="outline" onClick={() => setEditingId(row.distributor_id)} aria-label={`Set renewal for ${row.distributor_name}`}>Set Renewal</Button></td></tr>)}</tbody></table></div>}
      <div className="flex items-center justify-between p-4"><Button variant="outline" disabled={page === 1 || loading} onClick={() => setPage(value => value - 1)}>Previous</Button><span className="text-xs">Page {page} · {total} records</span><Button variant="outline" disabled={page * 50 >= total || loading} onClick={() => setPage(value => value + 1)}>Next</Button></div>
    </section>
    <RenewalEditorModal open={editingId !== null} distributorId={editingId} authFetch={authFetch} onClose={() => setEditingId(null)} onSave={() => { setEditingId(null); setMessage("Renewal saved successfully."); setLoading(true); void loadMetrics().catch(cause => setMetricsError(cause instanceof Error ? cause.message : "Unable to load renewal metrics.")); void loadList().catch(cause => setListError(cause instanceof Error ? cause.message : "Unable to load renewals.")).finally(() => setLoading(false)); }} />
  </div>;
}
