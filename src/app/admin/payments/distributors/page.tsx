"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Building2, FileSpreadsheet, Plus, Upload } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabaseClient";
import type {
  DistributorMetrics,
  DistributorStatusRow,
} from "@/lib/distributors/types";
import { renewalLabel } from "@/lib/distributors/domain";
import { executeReceivableCommand } from "@/lib/receivables/client";
import { formatInr } from "@/lib/receivables/domain";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Chip } from "@/components/ui/Chip";
import { Modal } from "@/components/ui/Modal";
import { DistributorImportModal } from "@/components/distributors/DistributorImportModal";
import { DistributorMasterImportModal } from "@/components/distributors/DistributorMasterImportModal";
import { ReceivablesCreateModal } from "@/components/receivables/ReceivablesCreateModal";
import { AdminReceivableActionModal } from "@/components/receivables/AdminReceivableActionModal";
import { ErpDistributionDonut, erpDistributionReconciles, type ErpDistributionCategory } from "@/components/analytics/ErpDistributionDonut";

const metricFilters = [
  ["Total Distributors", "total", {}],
  ["Installation Pending", "installation_pending", { installation: "pending" }],
  [
    "Training Pending",
    "training_pending",
    { installation: "done", training: "pending" },
  ],
  [
    "Installation + Training Done",
    "installation_training_done",
    { installation: "done", training: "done" },
  ],
  [
    "Mapped",
    "mapped",
    { installation: "done", training: "done", mapping: "done" },
  ],
  ["Active", "active", { activity: "active" }],
  ["Inactive", "inactive", { activity: "inactive" }],
  ["Billed", "billed", { billing: "billed" }],
] as const;
const blank = {
  distributor_name: "",
  distributor_reference: "",
  erp_id: null as string | null,
  erp_name: "",
  lead_id: "",
  phone: "",
  city: "",
  assigned_to: "",
  installation_status: "pending",
  installation_completed_at: "",
  training_status: "pending",
  training_completed_at: "",
  mapping_status: "pending",
  mapped_at: "",
  activity_status: "not_applicable",
  billing_status: "not_billed",
  erp_payment_status: "",
  billed_at: "",
  bill_reference: "",
  renewal_date: "",
  note: "",
};
interface OutstandingReceivable {
  receivable_id: string;
  bill_reference: string;
  outstanding_amount: string;
  version: number;
  pending_payment_count: number;
}
export default function DistributorStatusPage() {
  const operationId = useRef("");
  const { isAdmin } = useAuth(),
    [rows, setRows] = useState<DistributorStatusRow[]>([]),
    [metrics, setMetrics] = useState<DistributorMetrics | null>(null),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [filters, setFilters] = useState<Record<string, string>>({}),
    [activeCard, setActiveCard] = useState("total"),
    [assignees, setAssignees] = useState<
      Array<{ user_id: string; name: string; email: string }>
    >([]),
    [erps, setErps] = useState<Array<{ erp_id: string; erp_name: string }>>([]),
    [editing, setEditing] = useState<DistributorStatusRow | null | undefined>(
      undefined,
    ),
    [history, setHistory] = useState<
      Array<{
        event_id: string;
        event_type: string;
        previous_renewal_date: string | null;
        new_renewal_date: string | null;
        note: string | null;
        created_at: string;
      }>
    >([]),
    [importOpen, setImportOpen] = useState(false),
    [masterImportOpen, setMasterImportOpen] = useState(false),
    [message, setMessage] = useState(""),
    [listError, setListError] = useState(""),
    [metricsError, setMetricsError] = useState("");
  const [createFor, setCreateFor] = useState<DistributorStatusRow | null>(null),
    [paymentTarget, setPaymentTarget] = useState<OutstandingReceivable | null>(
      null,
    ),
    [selectionFor, setSelectionFor] = useState<DistributorStatusRow | null>(
      null,
    ),
    [candidates, setCandidates] = useState<OutstandingReceivable[]>([]),
    [selectionHasMore, setSelectionHasMore] = useState(false);
  const authFetch = useCallback(async (url: string, init?: RequestInit) => {
    const { data } = await supabase.auth.getSession();
    if (!data.session?.access_token) throw new Error("Sign in again.");
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${data.session.access_token}`);
    if (!(init?.body instanceof FormData) && !headers.has("Content-Type"))
      headers.set("Content-Type", "application/json");
    return fetch(url, { ...init, headers, cache: "no-store" });
  }, []);
  const query = useMemo(() => {
    const p = new URLSearchParams({
      page: String(page),
      pageSize: "50",
      search,
      ...filters,
    });
    return p.toString();
  }, [page, search, filters]);
  const loadList = useCallback(async () => {
    const response = await authFetch(`/api/distributors?${query}`),
      result = await response.json();
    if (!response.ok)
      throw new Error(result.message ?? "Distributor Status unavailable.");
    setRows(result.rows);
    setTotal(result.total);
    setListError("");
  }, [authFetch, query]);
  const loadMetrics = useCallback(async () => {
    const response = await authFetch("/api/distributors/metrics"),
      result = await response.json();
    if (!response.ok)
      throw new Error(result.message ?? "Distributor metrics unavailable.");
    setMetrics(result.metrics);
    setAssignees(result.assignees ?? []);
    setErps(result.erps ?? []);
    setMetricsError("");
  }, [authFetch]);
  useEffect(() => {
    if (!isAdmin) return;
    const timer = window.setTimeout(
      () => void loadList().catch((error) => setListError(error.message)),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [isAdmin, loadList]);
  useEffect(() => {
    if (!isAdmin) return;
    const timer = window.setTimeout(
      () => void loadMetrics().catch((error) => setMetricsError(error.message)),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [isAdmin, loadMetrics]);
  function choose(key: string, next: Record<string, string>) {
    setActiveCard(key);
    setFilters(next);
    setPage(1);
  }
  async function openEditor(row: DistributorStatusRow) {
    operationId.current = "";
    setEditing(row);
    setHistory([]);
    const response = await authFetch(`/api/distributors/${row.distributor_id}`);
    if (response.ok) {
      const result = await response.json();
      setHistory(result.events ?? []);
    }
  }
  async function save(form: FormData) {
    const value = Object.fromEntries(form.entries()),
      operation_type = editing
        ? value.action === "renew"
          ? "renew"
          : value.action === "erp_payment"
            ? "erp_payment"
            : "update"
        : "create",
      clearErp = value.erp_clear === "on";
    delete value.action;
    delete value.erp_clear;
    const erpPaymentStatus = value.erp_payment_status;
    delete value.erp_payment_status;
    const enteredErp = String(value.erp_name ?? "")
        .normalize("NFKC")
        .trim()
        .replace(/\s+/g, " "),
      currentErp = editing?.erp_name ?? "",
      erp_action = clearErp
        ? "clear"
        : !editing ||
            enteredErp.toLocaleLowerCase("en-IN") !==
              currentErp.toLocaleLowerCase("en-IN")
          ? "set"
          : "preserve";
    const payload =
      operation_type === "renew"
        ? {
            distributor_id: editing!.distributor_id,
            expected_version: editing!.version,
            renewal_date: value.renewal_date,
            note: value.note ?? "",
          }
        : operation_type === "erp_payment"
          ? {
              distributor_id: editing!.distributor_id,
              expected_version: editing!.version,
              erp_payment_status: erpPaymentStatus,
              note: value.note ?? "",
            }
          : {
            ...value,
            erp_name: enteredErp,
            erp_action,
            ...(editing
              ? {
                  distributor_id: editing.distributor_id,
                  expected_version: editing.version,
                }
              : {}),
            lead_id: value.lead_id || null,
            installation_completed_at: value.installation_completed_at || null,
            training_completed_at: value.training_completed_at || null,
            mapping_status: value.mapping_status || null,
            mapped_at: value.mapped_at || null,
            billed_at: value.billed_at || null,
            renewal_date: value.renewal_date || null,
          };
    operationId.current ||= crypto.randomUUID();
    const response = await authFetch("/api/distributors/commands", {
        method: "POST",
        body: JSON.stringify({
          operation_id: operationId.current,
          operation_type,
          payload,
        }),
      }),
      result = await response.json();
    if (!response.ok) throw new Error(result.message ?? result.code);
    operationId.current = "";
    setEditing(undefined);
    setMessage(
      operation_type === "renew"
        ? "Renewal date confirmed."
        : operation_type === "erp_payment"
          ? "ERP payment status confirmed."
        : "Distributor status confirmed.",
    );
    await Promise.all([loadList(), loadMetrics()]);
  }
  async function createReceivable(payload: Record<string, unknown>) {
    await executeReceivableCommand({
      operation_id: crypto.randomUUID(),
      operation_type: "create",
      payload,
    });
    setMessage("Receivable created and confirmed.");
    setCreateFor(null);
    await loadList();
  }
  async function startPayment(row: DistributorStatusRow) {
    setMessage("");
    const response = await authFetch(
        `/api/distributors/${row.distributor_id}/receivables`,
      ),
      result = await response.json();
    if (!response.ok)
      throw new Error(
        result.message ?? "Outstanding Receivables could not be loaded.",
      );
    const exact = (result.rows ?? []) as OutstandingReceivable[];
    if (!exact.length) {
      setMessage("No outstanding Receivable is available for payment.");
      return;
    }
    if (Number(result.total) === 1) {
      setPaymentTarget(exact[0]);
      return;
    }
    setCandidates(exact);
    setSelectionHasMore(Boolean(result.has_more));
    setSelectionFor(row);
  }
  async function recordPayment(payload: Record<string, unknown>) {
    if (!paymentTarget) throw new Error("Select an exact Receivable.");
    await executeReceivableCommand({
      operation_id: crypto.randomUUID(),
      operation_type: "direct_payment",
      payload: {
        ...payload,
        receivable_id: paymentTarget.receivable_id,
        expected_version: paymentTarget.version,
        payment_id: crypto.randomUUID(),
      },
    });
    setMessage(`Payment confirmed for ${paymentTarget.bill_reference}.`);
    setPaymentTarget(null);
    await loadList();
  }
  if (!isAdmin)
    return (
      <div className="app-page">
        <PageHeader
          title="Distributor Collections"
          description="System Administrator access required."
        />
      </div>
    );
  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Payment Collections"
        icon={<Building2 size={16} />}
        title="Distributor Collections"
        description="Distributor Status lifecycle alongside read-only canonical collection state."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => setMasterImportOpen(true)}
              icon={<FileSpreadsheet size={15} />}
            >
              Import / Update Master Workbook
            </Button>
            <Link href="/admin/payments">
              <Button variant="outline">Invoice Receivables</Button>
            </Link>
            <Button
              onClick={() => {
                operationId.current = "";
                setHistory([]);
                setEditing(null);
              }}
              icon={<Plus size={15} />}
            >
              Add Distributor
            </Button>
            <Button
              variant="outline"
              onClick={() => setImportOpen(true)}
              icon={<Upload size={15} />}
            >
              Distributor Import
            </Button>
          </div>
        }
      />
      {message && (
        <div className="alert-panel alert-panel--info" role="status">
          {message}
        </div>
      )}
      {listError && (
        <div className="alert-panel alert-panel--danger" role="alert">
          {listError}
        </div>
      )}
      {metricsError && (
        <div className="alert-panel alert-panel--danger" role="alert">
          {metricsError}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
        {metricFilters.map(([label, key, next]) => (
          <button
            type="button"
            key={key}
            onClick={() => choose(key, next)}
            className={`surface-panel p-4 text-left ${activeCard === key ? "ring-2 ring-[var(--brand-500)]" : ""}`}
            aria-pressed={activeCard === key}
          >
            <p className="text-[10px] font-semibold uppercase text-[var(--text-muted)]">
              {label}
            </p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">
              {metrics?.[key] ?? "—"}
            </p>
          </button>
        ))}
      </div>
      {metrics && <ErpDistributionDonut
        title="Distributor ERP Footprint"
        description="Official ERP assignment from Distributor Status. Each Distributor account is counted once."
        labelledBy="distributor-erp-footprint"
        total={metrics.total}
        totalLabel="Distributors"
        categories={metrics.erp_distribution.map((category): ErpDistributionCategory => category.erp_id === null ? { ...category, state: "unset" } : { ...category, state: "erp" })}
        reconciled={erpDistributionReconciles(metrics.erp_distribution, metrics.total)}
        emptyTitle="No Distributor accounts"
        emptyDescription="Official ERP assignment footprint will appear after Distributor Status accounts exist."
      />}
      {metrics?.total === 0 && !message && !listError && !metricsError && (
        <div className="alert-panel alert-panel--info">
          Distributor Status is active. No distributors have been created.
        </div>
      )}
      <section className="surface-panel overflow-hidden">
        <div className="grid gap-2 p-4 md:grid-cols-6">
          <Input
            aria-label="Search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search distributor or reference"
          />
          <select
            className="field-control"
            aria-label="ERP"
            value={filters.erpUnset ? "__unset" : (filters.erp ?? "")}
            onChange={(e) => {
              const value = e.target.value;
              setFilters({
                ...filters,
                erp: value && value !== "__unset" ? value : "",
                erpUnset: value === "__unset" ? "true" : "",
              });
              setPage(1);
            }}
          >
            <option value="">All ERP systems</option>
            <option value="__unset">ERP Not Set</option>
            {erps.map((erp) => (
              <option value={erp.erp_id} key={erp.erp_id}>
                {erp.erp_name}
              </option>
            ))}
          </select>
          <select
            className="field-control"
            aria-label="Assigned employee"
            value={filters.assignedTo ?? ""}
            onChange={(e) => {
              setFilters({ ...filters, assignedTo: e.target.value });
              setPage(1);
            }}
          >
            <option value="">All employees</option>
            {assignees.map((user) => (
              <option value={user.user_id} key={user.user_id}>
                {user.name}
              </option>
            ))}
          </select>
          <select
            className="field-control"
            aria-label="Renewal state"
            value={filters.renewal ?? ""}
            onChange={(e) => {
              setFilters({ ...filters, renewal: e.target.value });
              setPage(1);
            }}
          >
            <option value="">All renewals</option>
            <option value="due_soon">Renewal Due Soon</option>
          </select>
          <select
            className="field-control"
            aria-label="Payment Status"
            value={filters.paymentStatus ?? ""}
            onChange={(e) => {
              setFilters({ ...filters, paymentStatus: e.target.value });
              setPage(1);
            }}
          >
            <option value="">All payment statuses</option>
            <option value="PAID">Paid</option>
            <option value="NOT_PAID">Not Paid</option>
            <option value="DISPUTED">Disputed</option>
            <option value="COLLECTION_SETUP_REQUIRED">
              Collection Setup Required
            </option>
            <option value="NOT_BILLED">Not Billed</option>
          </select>
          <Button variant="outline" onClick={() => choose("total", {})}>
            Clear filters
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1580px] text-left text-xs">
            <thead>
              <tr>
                {[
                  "Distributor Name",
                  "ERP",
                  "Assigned Employee",
                  "Installation",
                  "Training",
                  "Mapping",
                  "Activity",
                  "Billing",
                  "Payment",
                  "ERP Payment",
                  "Received",
                  "Outstanding",
                  "Renewal Date",
                  "Renewal State",
                  "Last Updated",
                  "Actions",
                ].map((h) => (
                  <th key={h} className="p-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.distributor_id} className="border-t">
                  <td className="p-3 font-semibold">{row.distributor_name}</td>
                  <td className="p-3"><Chip>{row.erp_name ?? "Not Set"}</Chip></td>
                  <td className="p-3">{row.assigned_employee_name}</td>
                  <td className="p-3">
                    <Chip>{row.installation_status}</Chip>
                  </td>
                  <td className="p-3">
                    <Chip>{row.training_status}</Chip>
                  </td>
                  <td className="p-3">
                    <Chip>{row.mapping_status ?? "not captured"}</Chip>
                  </td>
                  <td className="p-3">
                    <Chip>{row.activity_status.replace("_", " ")}</Chip>
                  </td>
                  <td className="p-3">
                    <Chip>{row.billing_status.replace("_", " ")}</Chip>
                  </td>
                  <td className="p-3">
                    <Chip>
                      {row.collection_state?.replaceAll("_", " ") ??
                        "Unavailable"}
                    </Chip>
                  </td>
                  <td className="p-3">
                    <Chip>{row.erp_payment_status === "paid" ? "ERP Paid" : row.erp_payment_status === "not_paid" ? "ERP Not Paid" : "Not set"}</Chip>
                  </td>
                  <td className="p-3">
                    {formatInr(row.confirmed_collected_amount ?? "0.00")}
                  </td>
                  <td className="p-3 font-semibold">
                    {formatInr(row.outstanding_amount ?? "0.00")}
                  </td>
                  <td className="p-3">{row.renewal_date ?? "—"}</td>
                  <td className="p-3">
                    <Chip
                      variant={
                        row.renewal_state === "renewal_overdue"
                          ? "danger"
                          : row.renewal_state.includes("due")
                            ? "warning"
                            : "neutral"
                      }
                    >
                      {renewalLabel(row.renewal_state)}
                    </Chip>
                  </td>
                  <td className="p-3">
                    {new Date(row.updated_at).toLocaleString("en-IN", {
                      timeZone: "Asia/Kolkata",
                    })}
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void openEditor(row)}
                        aria-label={`Edit ${row.distributor_name}`}
                      >
                        Edit
                      </Button>
                      {row.billing_status === "billed" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setCreateFor(row)}
                        >
                          New Receivable
                        </Button>
                      )}
                      {Number(row.outstanding_amount ?? 0) > 0 && (
                        <Button
                          size="sm"
                          onClick={() =>
                            void startPayment(row).catch((error) =>
                              setMessage(error.message),
                            )
                          }
                        >
                          Record Payment
                        </Button>
                      )}
                    </div>
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
      <DistributorEditor
        open={editing !== undefined}
        row={editing ?? null}
        history={history}
        assignees={assignees}
        erps={erps}
        onClose={() => setEditing(undefined)}
        onSave={save}
      />
      <DistributorImportModal
        open={importOpen}
        authFetch={authFetch}
        onClose={() => setImportOpen(false)}
        onImported={async () => {
          setMessage("Distributor import confirmed.");
          await Promise.all([loadList(), loadMetrics()]);
        }}
      />
      <DistributorMasterImportModal
        open={masterImportOpen}
        authFetch={authFetch}
        onClose={() => setMasterImportOpen(false)}
        onImported={async (result) => {
          const distributors = result.distributors ?? {},
            receivables = result.receivables ?? {},
            payments = result.payments ?? {};
          setMessage(
            `Master import complete: ${Number(distributors.created_count ?? 0)} distributors created, ${Number(distributors.updated_count ?? 0)} updated; ${Number(receivables.created_count ?? 0)} Receivables created; ${Number(payments.created_count ?? 0)} payments confirmed.`,
          );
          await Promise.all([loadList(), loadMetrics()]);
        }}
      />
      <Modal
        open={Boolean(selectionFor)}
        onClose={() => {
          setSelectionFor(null);
          setCandidates([]);
        }}
        title="Select exact Receivable"
        description={
          selectionFor
            ? `Multiple outstanding invoices exist for ${selectionFor.distributor_name}. Choose the invoice this payment belongs to.`
            : ""
        }
      >
        <div className="space-y-2">
          {candidates.map((candidate) => (
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-lg border p-3 text-left"
              key={candidate.receivable_id}
              onClick={() => {
                setPaymentTarget(candidate);
                setSelectionFor(null);
              }}
            >
              <span>
                <b>{candidate.bill_reference}</b>
                <small className="block text-[var(--text-muted)]">
                  Receivable {candidate.receivable_id}
                </small>
              </span>
              <span className="font-semibold">
                {formatInr(candidate.outstanding_amount)}
              </span>
            </button>
          ))}
          {selectionHasMore && (
            <p className="text-xs text-[var(--status-warning)]">
              Showing the first 50 outstanding invoices. Refine the invoice in
              Invoice Receivables if the target is not shown.
            </p>
          )}
        </div>
      </Modal>
      <ReceivablesCreateModal
        open={Boolean(createFor)}
        initialDistributor={
          createFor
            ? {
                distributor_id: createFor.distributor_id,
                distributor_name: createFor.distributor_name,
                distributor_reference: createFor.distributor_reference,
                assigned_to: createFor.assigned_to,
                assigned_employee_name: createFor.assigned_employee_name,
                billing_status: createFor.billing_status,
              }
            : undefined
        }
        onClose={() => setCreateFor(null)}
        onCreate={createReceivable}
      />
      {paymentTarget && (
        <AdminReceivableActionModal
          action="direct_payment"
          open
          users={assignees}
          onClose={() => setPaymentTarget(null)}
          onSubmit={recordPayment}
        />
      )}
    </div>
  );
}
function DistributorEditor({
  open,
  row,
  history,
  assignees,
  erps,
  onClose,
  onSave,
}: {
  open: boolean;
  row: DistributorStatusRow | null;
  history: Array<{
    event_id: string;
    event_type: string;
    previous_renewal_date: string | null;
    new_renewal_date: string | null;
    note: string | null;
    created_at: string;
  }>;
  assignees: Array<{ user_id: string; name: string; email: string }>;
  erps: Array<{ erp_id: string; erp_name: string }>;
  onClose: () => void;
  onSave: (form: FormData) => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [pendingAction, setPendingAction] = useState("");
  const value = row
    ? {
        ...blank,
        ...row,
        lead_id: row.lead_id ?? "",
        distributor_reference: row.distributor_reference ?? "",
        phone: row.phone ?? "",
        city: row.city ?? "",
        installation_completed_at: row.installation_completed_at ?? "",
        training_completed_at: row.training_completed_at ?? "",
        mapping_status: row.mapping_status ?? "",
        mapped_at: row.mapped_at ?? "",
        billed_at: row.billed_at ?? "",
        bill_reference: row.bill_reference ?? "",
        renewal_date: row.renewal_date ?? "",
      }
    : blank;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={row ? "Edit Distributor Status" : "Add Distributor Status"}
      description="Operational facts only. This does not create or modify a Receivable."
    >
      <form
        key={row?.distributor_id ?? "new"}
        className="grid gap-3 sm:grid-cols-2"
        aria-busy={Boolean(pendingAction)}
        onSubmit={(event) => {
          event.preventDefault();
          if (pendingAction) return;
          setError("");
          const submitter = (event.nativeEvent as SubmitEvent).submitter;
          const action = String((submitter as HTMLButtonElement | null)?.value ?? "update");
          setPendingAction(action);
          void onSave(new FormData(event.currentTarget, submitter))
            .catch((cause) =>
              setError(
                cause instanceof Error ? cause.message : "Update failed.",
              ),
            )
            .finally(() => setPendingAction(""));
        }}
      >
        <Input
          name="distributor_name"
          label="Distributor Name"
          required
          defaultValue={value.distributor_name}
        />
        <div>
          <Input name="erp_name" label="ERP" list="erp-system-options" required={!row} defaultValue={value.erp_name ?? ""} placeholder="Choose or type a canonical ERP" />
          <datalist id="erp-system-options">{erps.map((erp) => <option key={erp.erp_id} value={erp.erp_name} />)}</datalist>
          {row && <label className="mt-2 flex items-center gap-2 text-xs font-medium"><input type="checkbox" name="erp_clear" /> Intentionally clear ERP</label>}
        </div>
        <Input
          name="distributor_reference"
          label="Distributor Reference"
          defaultValue={value.distributor_reference}
        />
        <Input name="phone" label="Phone" defaultValue={value.phone} />
        <Input name="city" label="City" defaultValue={value.city} />
        <label className="text-xs font-semibold">
          Assigned Employee
          <select
            name="assigned_to"
            className="field-control mt-1.5 w-full"
            required
            defaultValue={value.assigned_to}
          >
            <option value="">Select employee</option>
            {assignees.map((user) => (
              <option key={user.user_id} value={user.user_id}>
                {user.name}
              </option>
            ))}
          </select>
        </label>
        {[
          ["installation_status", "Installation", ["pending", "done"]],
          ["training_status", "Training", ["pending", "done"]],
          [
            "mapping_status",
            "Mapping",
            row?.mapping_status === null
              ? ["", "pending", "done"]
              : ["pending", "done"],
          ],
          [
            "activity_status",
            "Activity",
            ["not_applicable", "active", "inactive"],
          ],
          ["billing_status", "Billing", ["not_billed", "billed"]],
        ].map(([name, label, options]) => (
          <label key={name as string} className="text-xs font-semibold">
            {label as string}
            <select
              name={name as string}
              className="field-control mt-1.5 w-full"
              defaultValue={String(value[name as keyof typeof value])}
            >
              {(options as string[]).map((option) => (
                <option key={option} value={option}>
                  {option || "Legacy / not captured"}
                </option>
              ))}
            </select>
          </label>
        ))}
        <Input
          type="date"
          name="installation_completed_at"
          label="Installation Date"
          defaultValue={value.installation_completed_at}
        />
        <Input
          type="date"
          name="training_completed_at"
          label="Training Date"
          defaultValue={value.training_completed_at}
        />
        <Input
          type="date"
          name="mapped_at"
          label="Mapped Date"
          defaultValue={value.mapped_at}
        />
        <Input
          type="date"
          name="billed_at"
          label="Bill Date"
          defaultValue={value.billed_at}
        />
        <Input
          name="bill_reference"
          label="Operational Bill Reference"
          defaultValue={value.bill_reference}
        />
        <Input
          type="date"
          name="renewal_date"
          label="Renewal Date"
          defaultValue={value.renewal_date}
        />
        {row?.billing_status === "billed" && (
          <label className="text-xs font-semibold">
            ERP Payment
            <select
              name="erp_payment_status"
              className="field-control mt-1.5 w-full"
              defaultValue={value.erp_payment_status ?? ""}
            >
              <option value="">Select ERP payment status</option>
              <option value="paid">ERP Paid</option>
              <option value="not_paid">ERP Not Paid</option>
            </select>
          </label>
        )}
        <Input name="note" label="Update Note" />
        <input type="hidden" name="lead_id" value={value.lead_id} />
        {row && (
          <section className="sm:col-span-2">
            <h3 className="font-semibold">Status and renewal history</h3>
            {history.map((event) => (
              <div
                key={event.event_id}
                className="mt-2 border-l-2 pl-3 text-xs"
              >
                <b>{event.event_type.replaceAll("_", " ")}</b> ·{" "}
                {new Date(event.created_at).toLocaleString("en-IN", {
                  timeZone: "Asia/Kolkata",
                })}
                {event.previous_renewal_date !== event.new_renewal_date && (
                  <p>
                    {event.previous_renewal_date ?? "None"} →{" "}
                    {event.new_renewal_date ?? "None"}
                  </p>
                )}
                {event.note && <p>{event.note}</p>}
              </div>
            ))}
          </section>
        )}
        {error && (
          <p className="sm:col-span-2 text-sm text-[var(--status-danger)]">
            {error}
          </p>
        )}
        <div className="sm:col-span-2 flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          {row && (
            <Button type="submit" variant="outline" name="action" value="renew" disabled={Boolean(pendingAction)}>
              Set Renewal
            </Button>
          )}
          {row?.billing_status === "billed" && (
            <Button type="submit" variant="outline" name="action" value="erp_payment" isLoading={pendingAction === "erp_payment"} disabled={Boolean(pendingAction)}>
              {pendingAction === "erp_payment" ? "Saving ERP Payment" : "Save ERP Payment"}
            </Button>
          )}
          <Button type="submit" name="action" value="update" disabled={Boolean(pendingAction)}>
            Save Status
          </Button>
        </div>
      </form>
    </Modal>
  );
}
