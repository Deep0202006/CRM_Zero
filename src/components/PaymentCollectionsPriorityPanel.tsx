"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarClock } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { formatInr } from "@/lib/receivables/domain";
import { renewalLabel, type RenewalState } from "@/lib/distributors/domain";
import { Chip } from "@/components/ui/Chip";
import { Button } from "@/components/ui/Button";
import { getCurrentISTDate, getISTBusinessDayBounds } from "@/lib/dateTime";

interface Row { receivable_id: string; distributor_name: string; bill_reference: string; outstanding_amount: string; alert_state: string }
interface Renewal { distributor_id: string; distributor_name: string; renewal_date: string; renewal_state: RenewalState }
interface State {
  enabled: boolean;
  admin?: boolean;
  verificationPending?: number;
  urgentCount: number;
  outstandingAmount: string;
  rows: Row[];
  renewals_due_soon?: { total: number; rows: Renewal[] };
  renewals_error?: "UNAVAILABLE" | null;
}

export default function PaymentCollectionsPriorityPanel() {
  const [state, setState] = useState<State | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const lastStarted = useRef(0);
  const refresh = useCallback(() => {
    if (!navigator.onLine || inFlight.current || Date.now() - lastStarted.current < 1000) return inFlight.current ?? Promise.resolve();
    lastStarted.current = Date.now();
    const run = (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session?.access_token) return;
      const response = await fetch("/api/my-day/receivables", { headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: "no-store" });
      if (response.ok) setState(await response.json());
    })();
    inFlight.current = run;
    void run.finally(() => { if (inFlight.current === run) inFlight.current = null; });
    return run;
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    const rollover = getISTBusinessDayBounds(getCurrentISTDate());
    const timer = window.setTimeout(() => void refresh(), Math.max(1000, new Date(rollover.endsAt).getTime() - Date.now() + 250));
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
      window.clearTimeout(initial);
      window.clearTimeout(timer);
    };
  }, [refresh]);

  if (!state?.enabled) return null;
  const renewals = state.renewals_due_soon;
  return <>
    {state.renewals_error && <div className="alert-panel alert-panel--warning mb-5" role="status">Distributor renewal reminders are temporarily unavailable. Payment Collection data remains authoritative.</div>}
    {state.admin && Boolean(state.verificationPending) && <Priority title="Payment reports awaiting verification" detail={`${state.verificationPending} report${state.verificationPending === 1 ? "" : "s"} require authoritative review`} href="/admin/payments" button="Review payment reports" />}
    {!state.admin && state.rows.length > 0 && <section className="mb-5 overflow-hidden rounded-[var(--radius-xl)] border-2 border-[var(--status-danger)]/35 bg-[var(--status-danger-soft)]"><div className="flex flex-col gap-3 border-b p-5 sm:flex-row sm:items-center sm:justify-between"><div><p className="section-kicker">High priority</p><h2 className="section-title">Payment Collections</h2><p className="mt-1 text-sm font-semibold">{state.urgentCount} urgent · {formatInr(state.outstandingAmount)} outstanding</p></div><Link href="/payments"><Button size="sm">View payment follow-ups</Button></Link></div><div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">{state.rows.slice(0, 5).map((row) => <article key={row.receivable_id} className="rounded-lg bg-[var(--surface-primary)] p-4"><p className="truncate font-semibold">{row.distributor_name}</p><p className="mt-1 font-semibold">{formatInr(row.outstanding_amount)}</p><Chip variant="danger" size="sm">{row.alert_state.replaceAll("_", " ")}</Chip></article>)}</div></section>}
    {renewals && renewals.total > 0 && <section className="mb-5 rounded-[var(--radius-xl)] border border-[var(--status-warning)]/35 bg-[var(--status-warning-soft)] p-5" aria-labelledby="renewals-due-title"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-3"><CalendarClock className="text-[var(--status-warning)]" /><div><p className="section-kicker">Renewals</p><h2 id="renewals-due-title" className="section-title">Renewals Due Soon</h2><p className="text-sm">{renewals.total} assigned distributor{renewals.total === 1 ? "" : "s"} due or overdue</p></div></div><Link href={state.admin ? "/admin/payments/distributors" : "/payments/distributors"}><Button size="sm" variant="outline">View distributor status</Button></Link></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{renewals.rows.map((row) => <article className="rounded-lg bg-[var(--surface-primary)] p-3" key={row.distributor_id}><p className="truncate font-semibold">{row.distributor_name}</p><p className="text-xs text-[var(--text-muted)]">{row.renewal_date}</p><Chip variant={row.renewal_state === "renewal_overdue" ? "danger" : "warning"} size="sm">{renewalLabel(row.renewal_state)}</Chip></article>)}</div></section>}
  </>;
}

function Priority({ title, detail, href, button }: { title: string; detail: string; href: string; button: string }) {
  return <section className="mb-5 rounded-[var(--radius-xl)] border-2 border-[var(--status-warning)]/40 bg-[var(--status-warning-soft)] p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-3"><AlertTriangle /><div><p className="section-kicker">Admin priority</p><h2 className="section-title">{title}</h2><p className="text-sm">{detail}</p></div></div><Link href={href}><Button size="sm">{button}</Button></Link></div></section>;
}
