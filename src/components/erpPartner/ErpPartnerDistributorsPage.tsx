"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2 } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import { PageHeader } from "@/components/ui/PageHeader";
import { Input } from "@/components/ui/Input";
import { Chip } from "@/components/ui/Chip";
import { Button } from "@/components/ui/Button";

type Scope = { erp_id: string; erp_name: string };
type Metrics = {
  total: number;
  installation_pending: number;
  training_pending: number;
  not_billed: number;
  active: number;
  billed: number;
  paid: number;
  renewal_due_soon: number;
  renewal_overdue: number;
};
const kpiFilters = {
  total: {},
  installation_pending: { installation: "pending" },
  training_pending: { installation: "done", training: "pending" },
  not_billed: { billing: "not_billed" },
  active: { activity: "active" },
  billed: { billing: "billed" },
  paid: { erpPayment: "paid" },
  renewal_due_soon: { renewal: "due_soon" },
  renewal_overdue: { renewal: "overdue" },
} as const;
type KpiFilter = keyof typeof kpiFilters;
const emptyMetrics: Metrics = { total: 0, installation_pending: 0, training_pending: 0, not_billed: 0, active: 0, billed: 0, paid: 0, renewal_due_soon: 0, renewal_overdue: 0 };
type Row = {
  distributor_id: string;
  distributor_name: string;
  distributor_reference: string | null;
  erp_id: string;
  erp_name: string;
  city: string | null;
  installation_status: string;
  installation_completed_at: string | null;
  training_status: string;
  training_completed_at: string | null;
  mapping_status: string | null;
  mapped_at: string | null;
  activity_status: string;
  billing_status: string;
  erp_payment_status: "paid" | "not_paid" | null;
  renewal_date: string | null;
  renewal_state: string;
  updated_at: string;
};
export function ErpPartnerDistributorsPage() {
  const { isErpPartnerViewer } = useAuth(),
    [rows, setRows] = useState<Row[]>([]),
    [scopes, setScopes] = useState<Scope[]>([]),
    [metrics, setMetrics] = useState<Metrics>(emptyMetrics),
    [total, setTotal] = useState(0),
    [search, setSearch] = useState(""),
    [erp, setErp] = useState(""),
    [activeKpi, setActiveKpi] = useState<KpiFilter>("total"),
    [page, setPage] = useState(1),
    [error, setError] = useState("");
  const query = useMemo(
    () =>
      new URLSearchParams({
        page: String(page),
        pageSize: "50",
        search,
        ...(erp ? { erp } : {}),
        ...kpiFilters[activeKpi],
      }).toString(),
    [page, search, erp, activeKpi],
  );
  const load = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const response = await fetch(`/api/erp-partner/distributors?${query}`, {
        headers: { Authorization: `Bearer ${data.session?.access_token}` },
        cache: "no-store",
      }),
      result = await response.json();
    if (!response.ok)
      throw new Error(result.message ?? "ERP Distributor Status unavailable.");
    setRows(result.rows ?? []);
    setScopes(result.scopes ?? []);
    setMetrics({ ...emptyMetrics, ...result.metrics });
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
          title="ERP Distributor Status"
          description="ERP Partner Viewer access required."
        />
      </div>
    );
  return (
    <div className="app-page">
      <PageHeader
        eyebrow="ERP Partner Viewer"
        icon={<Building2 size={16} />}
        title="ERP Distributor Status"
        description="Read-only operational visibility for your assigned ERP scope."
      />
      <div className="flex flex-wrap gap-2">
        {scopes.map((scope) => (
          <Chip key={scope.erp_id} variant="brand">
            {scope.erp_name}
          </Chip>
        ))}
        {!scopes.length && <Chip variant="warning">No ERP scope assigned</Chip>}
      </div>
      {error && <div className="alert-panel alert-panel--danger">{error}</div>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {([
          ["total", "Total Distributors"],
          ["installation_pending", "Installation Pending"],
          ["training_pending", "Training Pending"],
          ["not_billed", "Not Billed"],
          ["active", "Active"],
          ["billed", "Billed"],
          ["paid", "Paid"],
          ["renewal_due_soon", "Renewal Due Soon"],
          ["renewal_overdue", "Renewal Overdue"],
        ] as const).map(([key, label]) => (
          <button
            type="button"
            aria-pressed={activeKpi === key}
            className={`surface-panel p-4 text-left ${activeKpi === key ? "ring-2 ring-[var(--brand-500)]" : ""}`}
            key={key}
            onClick={() => { setActiveKpi(key); setPage(1); }}
          >
            <p className="section-kicker">{label}</p>
            <p className="mt-2 text-2xl font-semibold">{metrics[key]}</p>
          </button>
        ))}
      </div>
      <section className="surface-panel overflow-hidden">
        <div className="grid gap-2 p-4 sm:grid-cols-2">
          <Input
            aria-label="Search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="Search distributor or reference"
          />
          {scopes.length > 1 && (
            <select
              className="field-control"
              aria-label="ERP scope"
              value={erp}
              onChange={(event) => {
                setErp(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All assigned ERP systems</option>
              {scopes.map((scope) => (
                <option key={scope.erp_id} value={scope.erp_id}>
                  {scope.erp_name}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] text-left text-xs">
            <thead>
              <tr>
                {[
                  "Distributor",
                  "Reference",
                  "ERP",
                  "City",
                  "Installation",
                  "Training",
                  "Mapping",
                  "Activity",
                  "Billing",
                  "ERP Payment",
                  "Renewal",
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
                  <td className="p-3">{row.city ?? "—"}</td>
                  <td className="p-3">{row.installation_status}</td>
                  <td className="p-3">{row.training_status}</td>
                  <td className="p-3">
                    {row.mapping_status ?? "Not captured"}
                  </td>
                  <td className="p-3">{row.activity_status}</td>
                  <td className="p-3">{row.billing_status}</td>
                  <td className="p-3">
                    {row.erp_payment_status === "paid" ? "ERP Paid" : row.erp_payment_status === "not_paid" ? "ERP Not Paid" : "Not set"}
                  </td>
                  <td className="p-3">{row.renewal_date ?? "Not set"}</td>
                  <td className="p-3">
                    {row.renewal_state === "not_actionable" ? "Not actionable until billed" : row.renewal_state.replaceAll("_", " ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-between p-4">
          <Button
            variant="outline"
            disabled={page === 1}
            onClick={() => setPage((value) => value - 1)}
          >
            Previous
          </Button>
          <span>
            Page {page} · {total} records
          </span>
          <Button
            variant="outline"
            disabled={page * 50 >= total}
            onClick={() => setPage((value) => value + 1)}
          >
            Next
          </Button>
        </div>
      </section>
    </div>
  );
}
