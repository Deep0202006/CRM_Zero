"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db, transactionalMutation, LocalLead, LocalMappingRequest } from "@/lib/db";
import { AlertCircle, CheckCircle2, Link2, Download, ArrowRightLeft } from "lucide-react";
import { SearchableSelect, SearchableOption } from "@/components/SearchableSelect";
import { QueueList } from "@/components/QueueList";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { PageHeader } from "@/components/ui/PageHeader";
import { MetricCard } from "@/components/ui/MetricCard";
import excelUsers from "@/lib/excel_users.json";

export default function MappingsPage() {
  const { currentUser, hasSupport } = useAuth();
  const [leads, setLeads] = useState<LocalLead[]>([]);
  const [mappings, setMappings] = useState<LocalMappingRequest[]>([]);
  
  // Form State
  const [activeSegment, setActiveSegment] = useState<"Distributor" | "Retailer">("Distributor");
  const [cardinality, setCardinality] = useState<"1:1" | "1:N">("1:1");
  const [primaryName, setPrimaryName] = useState("");
  const [secondaryNames, setSecondaryNames] = useState("");
  
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const excelOptions: SearchableOption[] = React.useMemo(() => (excelUsers as Array<{ username: string; name?: string }>).map((eu) => ({
    value: `EXCEL::${eu.username}::${eu.name || eu.username}`,
    label: `${eu.name || eu.username} (@${eu.username})`,
    searchText: eu.username + " " + (eu.name || "")
  })), []);

  const distributorOptions = React.useMemo(() => {
    const dbOptions: SearchableOption[] = leads.filter(l => l.segment_type === "Distributor").map(l => ({
      value: l.lead_id,
      label: l.contact_person ? `${l.business_name} - ${l.phone}` : l.business_name
    }));
    const map = new Map<string, SearchableOption>();
    dbOptions.forEach(opt => map.set(opt.label.toLowerCase(), opt));
    excelOptions.forEach(opt => {
      const rawName = opt.value.split("::")[2]?.toLowerCase();
      if (!map.has(rawName)) map.set(rawName, opt);
    });
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [leads, excelOptions]);

  const retailerOptions = React.useMemo(() => {
    const dbOptions: SearchableOption[] = leads.filter(l => l.segment_type === "Retailer").map(l => ({
      value: l.lead_id,
      label: l.contact_person ? `${l.business_name} - ${l.phone}` : l.business_name
    }));
    const map = new Map<string, SearchableOption>();
    dbOptions.forEach(opt => map.set(opt.label.toLowerCase(), opt));
    excelOptions.forEach(opt => {
      const rawName = opt.value.split("::")[2]?.toLowerCase();
      if (!map.has(rawName)) map.set(rawName, opt);
    });
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [leads, excelOptions]);

  const loadData = async () => {
    try {
      const allLeads = await db.leads.toArray();
      setLeads(allLeads);
      const allMaps = await db.mapping_requests.toArray();
      allMaps.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
      setMappings(allMaps);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const resolveLeadId = async (input: string, segmentType: "Distributor" | "Retailer"): Promise<string> => {
    if (!input.trim()) throw new Error("Empty input");
    
    const existing = leads.find(l => l.lead_id === input);
    if (existing) return existing.lead_id;

    let bName = input;
    if (input.startsWith("EXCEL::")) {
      const parts = input.split("::");
      const uName = parts[1];
      const fullName = parts[2] || uName;
      bName = `${fullName} (@${uName})`;
    }

    const nameMatch = leads.find(l => l.business_name.toLowerCase() === bName.trim().toLowerCase() && l.segment_type === segmentType);
    if (nameMatch) return nameMatch.lead_id;

    const newLeadId = crypto.randomUUID();
    const newLead: LocalLead = {
      lead_id: newLeadId,
      business_name: bName.trim(),
      contact_person: bName.trim(),
      phone: "0000000000",
      segment_type: segmentType,
      status: "New",
      assigned_to: currentUser?.user_id || null,
      created_at: new Date().toISOString(),
      lead_source: "Mapping Form"
    };

    await transactionalMutation("leads", "INSERT", newLead);

    setLeads(prev => [...prev, newLead]);
    return newLeadId;
  };

  const handleLogMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!primaryName.trim() || !secondaryNames.trim()) {
      setErrorMsg("Please provide both primary and secondary names.");
      return;
    }
    
    try {
      const primaryLeadId = await resolveLeadId(primaryName, activeSegment);
      
      let sNames = [secondaryNames.trim()];
      if (cardinality === "1:N") {
        sNames = secondaryNames.split(/[,\n]+/).map(s => s.trim()).filter(Boolean);
      }
      
      if (sNames.length === 0) {
        setErrorMsg("Please provide at least one secondary name.");
        return;
      }

      const newMaps: LocalMappingRequest[] = [];
      const timestamp = new Date().toISOString();

      for (let i = 0; i < sNames.length; i++) {
        const sName = sNames[i];
        const secondarySegment = activeSegment === "Distributor" ? "Retailer" : "Distributor";
        
        const secondaryLeadId = await resolveLeadId(sName, secondarySegment);
        const isDistPrimary = activeSegment === "Distributor";
        
        const newMapping: LocalMappingRequest = {
          request_id: crypto.randomUUID(),
          distributor_lead_id: isDistPrimary ? primaryLeadId : secondaryLeadId,
          retailer_lead_id: isDistPrimary ? secondaryLeadId : primaryLeadId,
          status: "Pending",
          mapped_by: currentUser?.user_id || null,
          created_at: timestamp,
        };
        newMaps.push(newMapping);
      }
      
      for (let i = 0; i < newMaps.length; i++) {
         await transactionalMutation("mapping_requests", "INSERT", newMaps[i]);
      }

      setSuccessMsg(`Successfully logged ${newMaps.length} mapping task(s).`);
      setTimeout(() => setSuccessMsg(null), 2500);
      setPrimaryName("");
      setSecondaryNames("");
      await loadData();
    } catch (err) {
      console.error(err);
      setErrorMsg("Failed to log mapping task.");
    }
  };

  const handleUpdateMappingStatus = async (request_id: string, newStatus: string) => {
    try {
      const updates: { status: string; completed_at?: string } = { status: newStatus };
      if (newStatus === "Completed") updates.completed_at = new Date().toISOString();
      await transactionalMutation("mapping_requests", "UPDATE", { request_id, ...updates });
      await loadData();
    } catch (err) {
      setErrorMsg("Failed to update mapping status.");
    }
  };

  // Identity vector standard: Format "{Name} (@{Username}) - {Phone}"
  const formatIdentity = (leadId: string, fallbackRole: string) => {
    if (!leadId) return `Unknown ${fallbackRole}`;
    if (leadId.startsWith("EXCEL::")) {
      const parts = leadId.split("::");
      if (parts.length === 3) return `${parts[2]} (@${parts[1]})`;
    }
    const l = leads.find(item => item.lead_id === leadId);
    if (l) {
      if (l.business_name.includes("(@")) return l.business_name;
      return `${l.business_name} - ${l.phone || "N/A"}`;
    }
    return `Unknown ${fallbackRole}`;
  };

  if (!hasSupport) {
    return (
      <section className="access-state" aria-labelledby="mapping-access-title">
        <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-[var(--radius-lg)] bg-[var(--status-danger-soft)] text-[var(--status-danger)]"><AlertCircle size={22} /></span>
        <h1 id="mapping-access-title" className="text-lg font-semibold">Mapping access is restricted</h1>
        <p className="mx-auto mt-2 max-w-sm text-[13px] leading-5 text-[var(--text-muted)]">Distributor-retailer linkage is available only to accounts with support capability.</p>
      </section>
    );
  }

  const primaryLabel = activeSegment;
  const secondaryLabel = activeSegment === "Distributor" ? "Retailer" : "Distributor";
  const pendingCount = mappings.filter((mapping) => mapping.status !== "Completed").length;
  const completedCount = mappings.filter((mapping) => mapping.status === "Completed").length;

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Relationship operations"
        icon={<Link2 size={18} />}
        title="Distributor-retailer mappings"
        description="Create clear relationship requests, review the operational queue, and close mappings with an auditable status."
        actions={
          <Button size="sm" variant="outline" onClick={() => import("@/lib/excelExport").then((module) => module.exportMasterMappings())} icon={<Download size={14} />}>
            Export mappings
          </Button>
        }
      />

      <div className="metric-grid">
        <MetricCard label="Pending mappings" value={pendingCount} icon={<Link2 size={17} />} tone="warning" note="Relationships waiting to be completed" />
        <MetricCard label="Completed" value={completedCount} icon={<CheckCircle2 size={17} />} tone="success" note="Verified distributor-retailer links" />
        <MetricCard label="Distributor records" value={distributorOptions.length} icon={<ArrowRightLeft size={17} />} tone="brand" note="Available distributor identities" />
        <MetricCard label="Retailer records" value={retailerOptions.length} icon={<ArrowRightLeft size={17} />} tone="neutral" note="Available retailer identities" />
      </div>

      {successMsg && <div className="alert-panel alert-panel--success" role="status"><CheckCircle2 size={16} className="mt-0.5 shrink-0" /><span>{successMsg}</span></div>}
      {errorMsg && <div className="alert-panel alert-panel--danger" role="alert"><AlertCircle size={16} className="mt-0.5 shrink-0" /><span>{errorMsg}</span></div>}

      <div className="workspace-split">
        <section className="surface-panel overflow-hidden" aria-labelledby="mapping-builder-title">
          <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-5">
            <p className="section-kicker">Mapping builder</p>
            <h2 id="mapping-builder-title" className="mt-1 section-title">Define the relationship</h2>
            <p className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">Choose the direction and cardinality first; the labels and available records update automatically.</p>
          </div>

          <form onSubmit={handleLogMapping} className="space-y-5 p-5 sm:p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <fieldset>
                <legend className="field-label">Relationship starts from</legend>
                <div className="segmented-control grid w-full grid-cols-2">
                  <button type="button" aria-pressed={activeSegment === "Distributor"} onClick={() => setActiveSegment("Distributor")}>Distributor</button>
                  <button type="button" aria-pressed={activeSegment === "Retailer"} onClick={() => setActiveSegment("Retailer")}>Retailer</button>
                </div>
              </fieldset>
              <fieldset>
                <legend className="field-label">Relationship type</legend>
                <div className="segmented-control grid w-full grid-cols-2">
                  <button type="button" aria-pressed={cardinality === "1:1"} onClick={() => setCardinality("1:1")}>One to one</button>
                  <button type="button" aria-pressed={cardinality === "1:N"} onClick={() => setCardinality("1:N")}>One to many</button>
                </div>
              </fieldset>
            </div>

            <div>
              <label className="field-label">Primary {primaryLabel}</label>
              <SearchableSelect options={activeSegment === "Distributor" ? distributorOptions : retailerOptions} value={primaryName} onChange={setPrimaryName} placeholder={`Search ${primaryLabel.toLowerCase()} records`} required />
            </div>

            <div className="flex items-center gap-3" aria-hidden="true">
              <span className="h-px flex-1 bg-[var(--border-subtle)]" />
              <span className="grid h-8 w-8 place-items-center rounded-full border border-[var(--border-default)] bg-[var(--surface-secondary)] text-[var(--brand-600)]"><ArrowRightLeft size={14} className="rotate-90" /></span>
              <span className="h-px flex-1 bg-[var(--border-subtle)]" />
            </div>

            <div>
              <label className="field-label">{cardinality === "1:N" ? `Secondary ${secondaryLabel}s` : `Secondary ${secondaryLabel}`}</label>
              {cardinality === "1:1" ? (
                <SearchableSelect options={activeSegment === "Distributor" ? retailerOptions : distributorOptions} value={secondaryNames} onChange={setSecondaryNames} placeholder={`Search ${secondaryLabel.toLowerCase()} records`} required />
              ) : (
                <textarea value={secondaryNames} onChange={(event) => setSecondaryNames(event.target.value)} placeholder={`Enter one ${secondaryLabel.toLowerCase()} per line or separate names with commas`} rows={5} className="field-control resize-y" required />
              )}
              {cardinality === "1:N" && <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">Each valid name becomes a separate pending mapping request.</p>}
            </div>

            <div className="flex justify-end border-t border-[var(--border-subtle)] pt-5">
              <Button type="submit" icon={<Link2 size={15} />} disabled={!primaryName.trim() || !secondaryNames.trim()}>Create mapping {cardinality === "1:N" ? "requests" : "request"}</Button>
            </div>
          </form>
        </section>

        <QueueList
          title="Mapping work queue"
          items={mappings.map((mapping) => ({
            id: mapping.request_id,
            primaryNode: (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--text-muted)]">Retailer → Distributor</p>
                <p className="mt-1.5 text-[13px] font-semibold leading-5 text-[var(--text-primary)]">{formatIdentity(mapping.retailer_lead_id, "Retailer")}</p>
                <p className="mt-1 flex items-center gap-2 text-[12px] text-[var(--text-secondary)]"><ArrowRightLeft size={12} className="text-[var(--brand-600)]" /> {formatIdentity(mapping.distributor_lead_id, "Distributor")}</p>
              </div>
            ),
            statusText: mapping.status,
            statusVariant: mapping.status === "Completed" ? "success" : "warning",
            timestamp: new Date(mapping.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
            actions: mapping.status !== "Completed" ? (
              <Button size="sm" variant="success" onClick={() => handleUpdateMappingStatus(mapping.request_id, "Completed")} icon={<CheckCircle2 size={13} />}>Complete</Button>
            ) : (
              <Chip variant="success" size="sm"><CheckCircle2 size={10} /> Verified</Chip>
            ),
          }))}
          emptyMessage="No mapping requests have been created."
          onRefresh={loadData}
        />
      </div>
    </div>
  );
}
