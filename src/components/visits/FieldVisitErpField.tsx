"use client";

import { useEffect, useMemo, useState } from "react";
import { SearchableSelect, type SearchableOption } from "@/components/SearchableSelect";
import { supabase } from "@/lib/supabaseClient";

export type ErpObservation = { usageState: "erp" | "none" | null; nameInput: string | null; erpId: string | null; erpName: string | null };
const key = (value: string) => value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-IN");

export function FieldVisitErpField({ value, onChange }: { value: ErpObservation; onChange: (value: ErpObservation) => void }) {
  const [systems, setSystems] = useState<Array<{ erp_id: string; erp_name: string }>>([]);
  const [loadError, setLoadError] = useState("");
  useEffect(() => { void (async () => {
    const { data } = await supabase.auth.getSession(); const token = data.session?.access_token;
    if (!token) return;
    const response = await fetch("/api/field-visits/erp-options", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const result = await response.json();
    if (!response.ok) { setLoadError("ERP options are unavailable. This visit remains safely local until the capability is available."); return; }
    setSystems(result.rows ?? []);
  })(); }, []);
  const options = useMemo<SearchableOption[]>(() => [{ value: "__none__", label: "None" }, ...systems.map((system) => ({ value: system.erp_name, label: system.erp_name, searchText: system.erp_name }))], [systems]);
  const display = value.usageState === "none" ? "__none__" : value.nameInput ?? "";
  const normalized = value.nameInput ? systems.find((system) => key(system.erp_name) === key(value.nameInput)) : undefined;
  return <div>
    <SearchableSelect label="ERP Used" required description="Select an existing ERP, type a new ERP name, or choose None." options={options} value={display} placeholder="Search or type ERP name" error={loadError || undefined} onChange={(next) => {
      if (next === "__none__" || key(next) === "none") { onChange({ usageState: "none", nameInput: null, erpId: null, erpName: null }); return; }
      const canonical = systems.find((system) => key(system.erp_name) === key(next));
      onChange({ usageState: "erp", nameInput: next, erpId: canonical?.erp_id ?? null, erpName: canonical?.erp_name ?? null });
    }} />
    {value.usageState === "erp" && value.nameInput?.trim() && !normalized && <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">New ERP: &ldquo;{value.nameInput.trim()}&rdquo; will be added after this visit is confirmed.</p>}
  </div>;
}
