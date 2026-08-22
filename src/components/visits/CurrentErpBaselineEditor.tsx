"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SearchableSelect, type SearchableOption } from "@/components/SearchableSelect";
import { Button } from "@/components/ui/Button";
import { supabase } from "@/lib/supabaseClient";
import { currentErpLabel, operationForCustomErp, type CurrentBusinessErpRow, type CurrentErpEdit, type CurrentErpOperation, type FieldBusinessSegment } from "@/lib/erp/currentBaseline";

interface ErpOption { erp_id: string; erp_name: string }
type StateFilter = "ALL" | "erp" | "none" | "not_captured";
const rowKey = (row: Pick<CurrentBusinessErpRow, "segment_type" | "business_ref">) => `${row.segment_type}\u0000${row.business_ref}`;
const formatTimestamp = (value: string | null) => value ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
const sourceLabel = (row: CurrentBusinessErpRow) => row.provenance === "manual_baseline" ? "Admin" : row.provenance === "field_visit" ? "Field Visit" : "Not captured";

export default function CurrentErpBaselineEditor({ onSaved }: { onSaved?: () => void }) {
  const [rows, setRows] = useState<CurrentBusinessErpRow[]>([]);
  const [erpSystems, setErpSystems] = useState<ErpOption[]>([]);
  const [drafts, setDrafts] = useState<Map<string, CurrentErpOperation>>(new Map());
  const [segment, setSegment] = useState<"ALL" | FieldBusinessSegment>("ALL");
  const [stateFilter, setStateFilter] = useState<StateFilter>("ALL");
  const [textSearch, setTextSearch] = useState("");
  const [businessRef, setBusinessRef] = useState("");
  const [appliedFilters, setAppliedFilters] = useState({ segment: "ALL" as "ALL" | FieldBusinessSegment, state: "ALL" as StateFilter, query: "", businessRef: "" });
  const [loading, setLoading] = useState(false), [saving, setSaving] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const requestSequence = useRef(0);

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true); setError("");
    try {
      const { data } = await supabase.auth.getSession(); const token = data.session?.access_token;
      if (!token) throw new Error("Authentication required.");
      const params = new URLSearchParams({ limit: "500" });
      if (appliedFilters.segment !== "ALL") params.set("segment", appliedFilters.segment);
      if (appliedFilters.state !== "ALL") params.set("state", appliedFilters.state);
      if (appliedFilters.query) params.set("query", appliedFilters.query);
      if (appliedFilters.businessRef) params.set("business_ref", appliedFilters.businessRef);
      const response = await fetch(`/api/admin/visits/erp-baselines?${params}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error("Current ERP businesses are temporarily unavailable.");
      if (sequence !== requestSequence.current) return;
      setRows(result.rows ?? []); setErpSystems(result.erp_systems ?? []);
      setDrafts((current) => { if (current.size) setNotice("Latest server values loaded; your unsaved edits were preserved."); return current; });
    } catch (cause) {
      if (sequence === requestSequence.current) setError(cause instanceof Error ? cause.message : "Current ERP businesses are temporarily unavailable.");
    } finally { if (sequence === requestSequence.current) setLoading(false); }
  }, [appliedFilters]);

  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const editOptions = useMemo<SearchableOption[]>(() => [
    { value: "__none__", label: "None", searchText: "explicit none no ERP" },
    { value: "__clear__", label: "Clear Admin baseline", searchText: "clear reveal visit not captured" },
    ...erpSystems.map((erp) => ({ value: `__erp__${erp.erp_id}`, label: erp.erp_name, searchText: erp.erp_name })),
  ], [erpSystems]);

  const setDraft = (row: CurrentBusinessErpRow, value: string) => {
    let edit: CurrentErpEdit | null;
    const normalized = value.normalize("NFKC").trim().replace(/\s+/g, " ");
    if (!normalized) {
      setDrafts((current) => { const next = new Map(current); next.delete(rowKey(row)); return next; });
      return;
    }
    if (value === "__none__") edit = { operation: "none" };
    else if (value === "__clear__") edit = { operation: "clear" };
    else if (value.startsWith("__erp__")) edit = { operation: "set", erp_id: value.slice(7) };
    else if (normalized.toLocaleLowerCase("en-IN") === "none") edit = { operation: "none" };
    else edit = operationForCustomErp(value);
    if (!edit) {
      setError("Custom ERP names must contain 1 to 160 characters and cannot use reserved action names.");
      setDrafts((current) => { const next = new Map(current); next.delete(rowKey(row)); return next; });
      return;
    }
    const operation = { ...edit, segment_type: row.segment_type, business_ref: row.business_ref } as CurrentErpOperation;
    setNotice(""); setDrafts((current) => { const next = new Map(current); next.set(rowKey(row), operation); return next; });
  };

  const operations = useMemo(() => [...drafts.values()], [drafts]);
  const draftValue = (row: CurrentBusinessErpRow) => {
    const draft = drafts.get(rowKey(row));
    if (!draft) return "";
    if (draft.operation === "none") return "__none__";
    if (draft.operation === "clear") return "__clear__";
    return draft.erp_id ? `__erp__${draft.erp_id}` : draft.erp_name ?? "";
  };

  const save = async () => {
    if (!operations.length) return;
    setSaving(true); setError(""); setNotice("");
    try {
      const { data } = await supabase.auth.getSession(); const token = data.session?.access_token;
      if (!token) throw new Error("Authentication required.");
      const response = await fetch("/api/admin/visits/erp-baselines", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ operations }) });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.message === "string" ? result.message : "No ERP edits were saved. Try again.");
      setDrafts(new Map()); setNotice(`${operations.length} business ERP edit${operations.length === 1 ? "" : "s"} saved.`);
      await load(); onSaved?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No ERP edits were saved. Try again."); }
    finally { setSaving(false); }
  };

  const applySearch = () => setAppliedFilters({ segment, state: stateFilter, query: textSearch.normalize("NFKC").trim().replace(/\s+/g, " "), businessRef: businessRef.trim() });

  return <section className="mb-6 rounded border border-[var(--border-subtle)] bg-[var(--surface-primary)] p-4" aria-labelledby="current-erp-editor-title">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="current-erp-editor-title" className="font-semibold">Current business ERP editor</h2><p className="text-xs text-[var(--text-secondary)]">Search a bounded set of exact visited businesses. Refresh and filters preserve unsaved edits.</p></div><div className="flex gap-2"><Button size="sm" variant="outline" isLoading={loading} onClick={() => void load()}>Refresh</Button><Button size="sm" isLoading={saving} disabled={!operations.length} onClick={() => void save()}>Save {operations.length} changes</Button></div></div>
    <div className="my-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
      <input aria-label="Search business or ERP" className="field-control" placeholder="Business name, reference, or ERP" maxLength={160} value={textSearch} onChange={(event) => setTextSearch(event.target.value)} />
      <input aria-label="Exact business reference" className="field-control" placeholder="Exact business reference" maxLength={256} value={businessRef} onChange={(event) => setBusinessRef(event.target.value)} />
      <select aria-label="Business type" className="field-control" value={segment} onChange={(event) => setSegment(event.target.value as typeof segment)}><option value="ALL">All</option><option value="Retailer">Retailers</option><option value="Distributor">Distributors</option></select>
      <select aria-label="Current ERP state" className="field-control" value={stateFilter} onChange={(event) => setStateFilter(event.target.value as StateFilter)}><option value="ALL">All states</option><option value="not_captured">Not captured</option><option value="erp">ERP assigned</option><option value="none">None</option></select>
      <Button variant="outline" onClick={applySearch}>Search</Button>
    </div>
    {error && <div role="alert" className="mb-3 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error} Unsaved edits remain available.</div>}{notice && <div role="status" className="mb-3 rounded border border-green-300 bg-green-50 p-3 text-sm text-green-800">{notice}</div>}
    <div className="max-h-[36rem] overflow-auto"><table className="w-full min-w-[1120px] text-left text-sm"><thead><tr className="border-b"><th className="p-2">Business</th><th className="p-2">Type</th><th className="p-2">Current ERP</th><th className="p-2">Latest visit</th><th className="p-2">Source</th><th className="p-2">Last updated</th><th className="min-w-64 p-2">Edit current ERP</th></tr></thead><tbody>
      {rows.map((row) => { const key = rowKey(row), draft = drafts.get(key); return <tr key={key} className="border-b align-top"><td className="p-2"><strong>{row.business_name?.trim() || row.business_ref}</strong>{row.business_name && <><br /><span className="break-all text-xs text-[var(--text-muted)]">{row.business_ref}</span></>}</td><td className="p-2">{row.segment_type}</td><td className="p-2">{currentErpLabel(row)}{draft && <span className="ml-2 rounded bg-amber-100 px-2 py-1 text-xs text-amber-900">Unsaved</span>}</td><td className="p-2 text-xs">{formatTimestamp(row.latest_visit_at)}</td><td className="p-2 text-xs">{sourceLabel(row)}</td><td className="p-2 text-xs">{formatTimestamp(row.effective_at)}</td><td className="p-2"><SearchableSelect label={`ERP for ${row.business_name?.trim() || row.business_ref}`} description="Choose an existing ERP, type a custom ERP, select None, or clear the Admin baseline." options={editOptions} value={draftValue(row)} placeholder="Search, type, None, or clear" onChange={(value) => setDraft(row, value)} /></td></tr>; })}
    </tbody></table>{!loading && !rows.length && <p className="p-4 text-sm text-[var(--text-secondary)]">No visited business matches the selected filters.</p>}</div>
  </section>;
}
