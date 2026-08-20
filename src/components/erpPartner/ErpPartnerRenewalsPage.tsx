"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import { PageHeader } from "@/components/ui/PageHeader";
import { Chip } from "@/components/ui/Chip";
import { Button } from "@/components/ui/Button";
type Row = {
  distributor_id: string;
  distributor_name: string;
  distributor_reference: string | null;
  erp_id: string;
  erp_name: string;
  renewal_date: string | null;
  renewal_state: string;
};
type Metrics = {
  overdue: number;
  today: number;
  tomorrow: number;
  in_two_days: number;
};
export function ErpPartnerRenewalsPage() {
  const { isErpPartnerViewer } = useAuth(),
    [rows, setRows] = useState<Row[]>([]),
    [metrics, setMetrics] = useState<Metrics>({
      overdue: 0,
      today: 0,
      tomorrow: 0,
      in_two_days: 0,
    }),
    [filter, setFilter] = useState("all"),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [error, setError] = useState("");
  const query = useMemo(
    () =>
      new URLSearchParams({
        filter,
        page: String(page),
        pageSize: "50",
      }).toString(),
    [filter, page],
  );
  const load = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const response = await fetch(`/api/erp-partner/renewals?${query}`, {
        headers: { Authorization: `Bearer ${data.session?.access_token}` },
        cache: "no-store",
      }),
      result = await response.json();
    if (!response.ok)
      throw new Error(result.message ?? "ERP Renewals unavailable.");
    setRows(result.rows ?? []);
    setMetrics(
      result.metrics ?? {
        overdue: 0,
        today: 0,
        tomorrow: 0,
        in_two_days: 0,
      },
    );
    setTotal(result.total ?? 0);
    setError("");
  }, [query]);
  useEffect(() => {
    if (!isErpPartnerViewer) return;
    const timer = window.setTimeout(
      () => void load().catch((cause) => setError(cause.message)),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [isErpPartnerViewer, load]);
  if (!isErpPartnerViewer)
    return (
      <div className="app-page">
        <PageHeader
          title="ERP Renewals"
          description="ERP Partner Viewer access required."
        />
      </div>
    );
  return (
    <div className="app-page">
      <PageHeader
        eyebrow="ERP Partner Viewer"
        icon={<CalendarDays size={16} />}
        title="ERP Renewals"
        description="Read-only renewal visibility for assigned ERP systems."
      />
      {error && <div className="alert-panel alert-panel--danger">{error}</div>}
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Overdue", "overdue"],
          ["Today", "today"],
          ["Tomorrow", "tomorrow"],
          ["In 2 Days", "in_two_days"],
        ].map(([label, key]) => (
          <button
            type="button"
            className="surface-panel p-4 text-left"
            key={key}
            onClick={() => {
              setFilter(key);
              setPage(1);
            }}
          >
            <p className="section-kicker">{label}</p>
            <p className="mt-2 text-2xl font-semibold">
              {metrics[key as keyof Metrics]}
            </p>
          </button>
        ))}
      </div>
      <section className="surface-panel overflow-hidden">
        <div className="p-4">
          <select
            className="field-control"
            aria-label="Renewal state"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setPage(1);
            }}
          >
            <option value="all">All</option>
            <option value="overdue">Overdue</option>
            <option value="today">Today</option>
            <option value="tomorrow">Tomorrow</option>
            <option value="in_two_days">In 2 Days</option>
          </select>
        </div>
        <table className="w-full min-w-[700px] text-left text-xs">
          <thead>
            <tr>
              {[
                "Distributor",
                "Reference",
                "ERP",
                "Renewal Date",
                "Renewal State",
              ].map((h) => (
                <th className="p-3" key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr className="border-t" key={row.distributor_id}>
                <td className="p-3 font-semibold">{row.distributor_name}</td>
                <td className="p-3">{row.distributor_reference ?? "—"}</td>
                <td className="p-3">
                  <Chip>{row.erp_name}</Chip>
                </td>
                <td className="p-3">{row.renewal_date ?? "Not set"}</td>
                <td className="p-3">
                  {row.renewal_state.replaceAll("_", " ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="flex justify-between p-4">
          <Button
            variant="outline"
            disabled={page === 1}
            onClick={() => setPage((v) => v - 1)}
          >
            Previous
          </Button>
          <span>
            Page {page} · {total} records
          </span>
          <Button
            variant="outline"
            disabled={page * 50 >= total}
            onClick={() => setPage((v) => v + 1)}
          >
            Next
          </Button>
        </div>
      </section>
    </div>
  );
}
