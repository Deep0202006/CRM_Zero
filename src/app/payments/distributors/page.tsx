"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Building2 } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import type { DistributorStatusRow } from "@/lib/distributors/types";
import { renewalLabel } from "@/lib/distributors/domain";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";

export default function AssignedDistributorStatusPage() {
  const [rows, setRows] = useState<DistributorStatusRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session?.access_token) throw new Error("Sign in again.");
    const response = await fetch(`/api/distributors?page=${page}&pageSize=50`, {
      headers: { Authorization: `Bearer ${data.session.access_token}` },
      cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message ?? "Distributor Status unavailable.");
    setRows(result.rows);
    setTotal(result.total);
  }, [page]);

  useEffect(() => {
    const deferredLoad = window.setTimeout(() => { void load().catch((error) => setMessage(error.message)); }, 0);
    return () => window.clearTimeout(deferredLoad);
  }, [load]);

  return <div className="app-page">
    <PageHeader eyebrow="Payment Collections" icon={<Building2 size={16} />} title="Distributor Status" description="Read-only operational and renewal status for your assigned distributors." actions={<Link href="/payments"><Button variant="outline">Payment Follow-ups</Button></Link>} />
    {message && <div className="alert-panel alert-panel--info">{message}</div>}
    <div className="grid gap-3">
      {rows.map((row) => <article key={row.distributor_id} className="surface-panel p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-semibold">{row.distributor_name}</h2><p className="text-xs text-[var(--text-muted)]">Renewal {row.renewal_date ?? "not set"}</p></div><div className="flex flex-wrap gap-2"><Chip>Installation {row.installation_status}</Chip><Chip>Training {row.training_status}</Chip><Chip>{row.activity_status.replace("_", " ")}</Chip><Chip>{row.billing_status.replace("_", " ")}</Chip><Chip variant={row.renewal_state === "renewal_overdue" ? "danger" : row.renewal_state.includes("due") ? "warning" : "neutral"}>{renewalLabel(row.renewal_state)}</Chip></div></div></article>)}
      {!rows.length && !message && <p className="text-sm text-[var(--text-muted)]">No distributors are assigned to you.</p>}
    </div>
    <div className="flex justify-between"><Button variant="outline" disabled={page === 1} onClick={() => setPage((value) => value - 1)}>Previous</Button><span>{total} assigned</span><Button variant="outline" disabled={page * 50 >= total} onClick={() => setPage((value) => value + 1)}>Next</Button></div>
  </div>;
}
