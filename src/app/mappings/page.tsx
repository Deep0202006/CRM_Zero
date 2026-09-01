"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db, transactionalMutation, queueMappingOwnerUpdate, processSyncQueue, LocalMappingRequest, LocalUser } from "@/lib/db";
import { isSupabaseConfigured, supabase } from "@/lib/supabaseClient";
import { AlertCircle, CheckCircle2, Link2, Download, ArrowRightLeft } from "lucide-react";
import { SearchableSelect, SearchableOption } from "@/components/SearchableSelect";
import { QueueList } from "@/components/QueueList";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { PageHeader } from "@/components/ui/PageHeader";
import { MetricCard } from "@/components/ui/MetricCard";
import excelUsers from "@/lib/excel_users.json";
import { buildCanonicalClientOptions, resolveClientOptionInput } from "@/lib/clientOptions";
import { mappingRequestSchema } from "@/lib/validation";

export default function MappingsPage() {
  const { currentUser, hasSupport, isAdmin } = useAuth();
  const [mappings, setMappings] = useState<LocalMappingRequest[]>([]);
  const [mappingUsers, setMappingUsers] = useState<LocalUser[]>([]);
  const [scope, setScope] = useState<"team" | "mine" | "logged">("team");
  const [actorDimension, setActorDimension] = useState<"mapped_by" | "requested_by">("mapped_by");
  const [actorId, setActorId] = useState("");
  const [search, setSearch] = useState("");
  
  // Form State
  const [activeSegment, setActiveSegment] = useState<"Distributor" | "Retailer">("Distributor");
  const [cardinality, setCardinality] = useState<"1:1" | "1:N">("1:1");
  const [primaryName, setPrimaryName] = useState("");
  const [secondaryNames, setSecondaryNames] = useState("");
  const [mappingNotes, setMappingNotes] = useState("");
  const [mappingStatus, setMappingStatus] = useState<"Pending" | "Completed">("Pending");
  const [editingMapping, setEditingMapping] = useState<LocalMappingRequest | null>(null);
  
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const clientOptions: SearchableOption[] = React.useMemo(
    () => buildCanonicalClientOptions(excelUsers as Array<{ username: string; name?: string }>),
    [],
  );

  const loadData = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.onLine) {
        await processSyncQueue();
        if (isSupabaseConfigured) {
          const pendingIds = new Set((await db.sync_queue.filter((item) => item.table_name === "mapping_requests").toArray()).map((item) => (item.data as Partial<LocalMappingRequest>).request_id));
          const { data, error } = await supabase.from("mapping_requests")
            .select("request_id,distributor_lead_id,retailer_lead_id,distributor_name_unregistered,retailer_name_unregistered,requested_by,mapped_by,requested_by_id_snapshot,mapped_by_id_snapshot,requested_by_name_snapshot,mapped_by_name_snapshot,status,notes,created_at,completed_at")
            .order("created_at", { ascending: false }).limit(50);
          if (error) throw error;
          const safeRows = (data ?? []).filter((row) => !pendingIds.has(row.request_id)) as LocalMappingRequest[];
          if (safeRows.length) await db.mapping_requests.bulkPut(safeRows);
        }
      }
      const allMaps = await db.mapping_requests.orderBy("created_at").reverse().limit(50).toArray();
      setMappingUsers(await db.users.toArray());
      setMappings(allMaps);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadData();
    const refresh = () => { loadData(); };
    window.addEventListener("zerodata:mapping-requests-changed", refresh);
    return () => window.removeEventListener("zerodata:mapping-requests-changed", refresh);
  }, []);

  const handleLogMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    const actor = currentUser;
    if (!actor) return;
    if (!primaryName.trim() || !secondaryNames.trim()) {
      setErrorMsg("Please provide both primary and secondary names.");
      return;
    }
    
    try {
      const primary = resolveClientOptionInput(primaryName, clientOptions);

      if (editingMapping) {
        if (editingMapping.requested_by !== actor.user_id) throw new Error("Only the employee who logged this Mapping may update it.");
        const secondary = resolveClientOptionInput(secondaryNames.trim(), clientOptions);
        const isDistPrimary = activeSegment === "Distributor";
        const enteringCompleted = editingMapping.status !== "Completed" && mappingStatus === "Completed";
        const optimistic: LocalMappingRequest = mappingRequestSchema.parse({
          ...editingMapping,
          distributor_lead_id: isDistPrimary ? primary.leadId : secondary.leadId,
          retailer_lead_id: isDistPrimary ? secondary.leadId : primary.leadId,
          distributor_name_unregistered: isDistPrimary ? primary.displayValue : secondary.displayValue,
          retailer_name_unregistered: isDistPrimary ? secondary.displayValue : primary.displayValue,
          notes: mappingNotes.trim() || null,
          status: mappingStatus,
          mapped_by: mappingStatus === "Pending" ? null : enteringCompleted ? actor.user_id : editingMapping.mapped_by,
          mapped_by_id_snapshot: mappingStatus === "Pending" ? null : enteringCompleted ? actor.user_id : editingMapping.mapped_by_id_snapshot,
          mapped_by_name_snapshot: mappingStatus === "Pending" ? null : enteringCompleted ? actor.name : editingMapping.mapped_by_name_snapshot,
          completed_at: mappingStatus === "Pending" ? null : enteringCompleted ? new Date().toISOString() : editingMapping.completed_at,
        }) as LocalMappingRequest;
        await queueMappingOwnerUpdate(optimistic);
        if (navigator.onLine) await processSyncQueue();
        setEditingMapping(null); setPrimaryName(""); setSecondaryNames(""); setMappingNotes(""); setMappingStatus("Pending");
        setSuccessMsg("Mapping update saved safely.");
        await loadData();
        setTimeout(() => setSuccessMsg(null), 2500);
        return;
      }
      
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
        const secondary = resolveClientOptionInput(sName, clientOptions);
        const isDistPrimary = activeSegment === "Distributor";
        
        const newMapping: LocalMappingRequest = {
          request_id: crypto.randomUUID(),
          distributor_lead_id: isDistPrimary ? primary.leadId : secondary.leadId,
          retailer_lead_id: isDistPrimary ? secondary.leadId : primary.leadId,
          distributor_name_unregistered: isDistPrimary ? primary.displayValue : secondary.displayValue,
          retailer_name_unregistered: isDistPrimary ? secondary.displayValue : primary.displayValue,
          status: "Pending",
          notes: mappingNotes.trim() || null,
          requested_by: actor.user_id,
          mapped_by: null,
          created_at: timestamp,
        };
        newMaps.push(mappingRequestSchema.parse(newMapping) as LocalMappingRequest);
      }
      
      for (let i = 0; i < newMaps.length; i++) {
         await transactionalMutation("mapping_requests", "INSERT", newMaps[i]);
      }

      setSuccessMsg(`Successfully logged ${newMaps.length} mapping task(s).`);
      setTimeout(() => setSuccessMsg(null), 2500);
      setPrimaryName("");
      setSecondaryNames("");
      setMappingNotes("");
      await loadData();
    } catch (err) {
      console.error(err);
      setErrorMsg(err instanceof Error ? err.message : "Failed to log mapping task.");
    }
  };

  const editMapping = (mapping: LocalMappingRequest) => {
    if (mapping.requested_by !== currentUser?.user_id) return;
    setEditingMapping(mapping);
    setActiveSegment("Distributor"); setCardinality("1:1");
    setPrimaryName(mapping.distributor_lead_id ?? mapping.distributor_name_unregistered ?? "");
    setSecondaryNames(mapping.retailer_lead_id ?? mapping.retailer_name_unregistered ?? "");
    setMappingNotes(mapping.notes ?? ""); setMappingStatus(mapping.status);
    setErrorMsg(null); setSuccessMsg(null);
  };

  const cancelEdit = () => {
    setEditingMapping(null); setPrimaryName(""); setSecondaryNames(""); setMappingNotes(""); setMappingStatus("Pending"); setErrorMsg(null);
  };

  // Identity vector standard: Format "{Name} (@{Username}) - {Phone}"
  const formatIdentity = (displayValue: string | null | undefined, leadId: string | null, fallbackRole: string) => {
    return displayValue?.trim() || leadId?.trim() || `Unknown ${fallbackRole}`;
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
  const resolveActorId = (live?: string | null, snapshot?: string | null) => live ?? snapshot ?? null;
  const userLabel = (live?: string | null, nameSnapshot?: string | null, idSnapshot?: string | null) => mappingUsers.find((user) => user.user_id === resolveActorId(live, idSnapshot))?.name?.trim() || nameSnapshot?.trim() || "Unknown/Former employee";
  const actorOptions = Array.from(new Map(mappings.flatMap((mapping) => {
    const requesterId = resolveActorId(mapping.requested_by, mapping.requested_by_id_snapshot);
    const completerId = resolveActorId(mapping.mapped_by, mapping.mapped_by_id_snapshot);
    return [
      ...(requesterId ? [[requesterId, userLabel(mapping.requested_by, mapping.requested_by_name_snapshot, mapping.requested_by_id_snapshot)] as const] : []),
      ...(completerId ? [[completerId, userLabel(mapping.mapped_by, mapping.mapped_by_name_snapshot, mapping.mapped_by_id_snapshot)] as const] : []),
    ];
  })).entries());
  const visibleMappings = mappings.filter((mapping) => {
    if (scope === "mine" && !(mapping.status === "Completed" && resolveActorId(mapping.mapped_by, mapping.mapped_by_id_snapshot) === currentUser?.user_id)) return false;
    if (scope === "logged" && resolveActorId(mapping.requested_by, mapping.requested_by_id_snapshot) !== currentUser?.user_id) return false;
    if (isAdmin && actorId && resolveActorId(mapping[actorDimension], actorDimension === "requested_by" ? mapping.requested_by_id_snapshot : mapping.mapped_by_id_snapshot) !== actorId) return false;
    return [mapping.distributor_name_unregistered, mapping.retailer_name_unregistered, userLabel(mapping.requested_by, mapping.requested_by_name_snapshot, mapping.requested_by_id_snapshot), userLabel(mapping.mapped_by, mapping.mapped_by_name_snapshot, mapping.mapped_by_id_snapshot)].join(" ").toLowerCase().includes(search.toLowerCase());
  });

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
        <MetricCard label="Team completed" value={completedCount} icon={<CheckCircle2 size={17} />} tone="success" note="Completed mappings" />
        <MetricCard label="My completed" value={mappings.filter((m) => m.status === "Completed" && resolveActorId(m.mapped_by, m.mapped_by_id_snapshot) === currentUser?.user_id).length} icon={<CheckCircle2 size={17} />} tone="brand" note="Work I completed" />
        <MetricCard label="Pending" value={pendingCount} icon={<Link2 size={17} />} tone="warning" note="Relationships waiting" />
        <MetricCard label="Contributors" value={new Set(mappings.filter((m) => m.status === "Completed").map((m) => resolveActorId(m.mapped_by, m.mapped_by_id_snapshot)).filter(Boolean)).size} icon={<ArrowRightLeft size={17} />} tone="neutral" note="Completed actors" />
      </div>

      {successMsg && <div className="alert-panel alert-panel--success" role="status"><CheckCircle2 size={16} className="mt-0.5 shrink-0" /><span>{successMsg}</span></div>}
      {errorMsg && <div className="alert-panel alert-panel--danger" role="alert"><AlertCircle size={16} className="mt-0.5 shrink-0" /><span>{errorMsg}</span></div>}

      <div className="workspace-split">
        <section className="surface-panel overflow-hidden" aria-labelledby="mapping-builder-title">
          <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-5">
            <p className="section-kicker">{editingMapping ? "Creator update" : "Mapping builder"}</p>
            <h2 id="mapping-builder-title" className="mt-1 section-title">{editingMapping ? "Update the relationship" : "Define the relationship"}</h2>
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
              {!editingMapping && <fieldset>
                <legend className="field-label">Relationship type</legend>
                <div className="segmented-control grid w-full grid-cols-2">
                  <button type="button" aria-pressed={cardinality === "1:1"} onClick={() => setCardinality("1:1")}>One to one</button>
                  <button type="button" aria-pressed={cardinality === "1:N"} onClick={() => setCardinality("1:N")}>One to many</button>
                </div>
              </fieldset>}
            </div>

            <div>
              <label className="field-label">Primary {primaryLabel}</label>
              <SearchableSelect options={clientOptions} value={primaryName} onChange={setPrimaryName} placeholder={`Search or type ${primaryLabel.toLowerCase()}`} required />
            </div>

            <div className="flex items-center gap-3" aria-hidden="true">
              <span className="h-px flex-1 bg-[var(--border-subtle)]" />
              <span className="grid h-8 w-8 place-items-center rounded-full border border-[var(--border-default)] bg-[var(--surface-secondary)] text-[var(--brand-600)]"><ArrowRightLeft size={14} className="rotate-90" /></span>
              <span className="h-px flex-1 bg-[var(--border-subtle)]" />
            </div>

            <div>
              <label className="field-label">{cardinality === "1:N" ? `Secondary ${secondaryLabel}s` : `Secondary ${secondaryLabel}`}</label>
              {cardinality === "1:1" ? (
                <SearchableSelect options={clientOptions} value={secondaryNames} onChange={setSecondaryNames} placeholder={`Search or type ${secondaryLabel.toLowerCase()}`} required />
              ) : (
                <textarea value={secondaryNames} onChange={(event) => setSecondaryNames(event.target.value)} placeholder={`Enter one ${secondaryLabel.toLowerCase()} per line or separate names with commas`} rows={5} className="field-control resize-y" required />
              )}
              {cardinality === "1:N" && <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">Each valid name becomes a separate pending mapping request.</p>}
            </div>

            <div>
              <label htmlFor="mapping-notes" className="field-label">Notes</label>
              <textarea id="mapping-notes" value={mappingNotes} onChange={(event) => setMappingNotes(event.target.value)} rows={3} className="field-control resize-y" placeholder="Mapping context or instructions" />
            </div>

            {editingMapping && <div><label htmlFor="mapping-status" className="field-label">Mapping status</label><select id="mapping-status" value={mappingStatus} onChange={(event) => setMappingStatus(event.target.value as "Pending" | "Completed")} className="field-control"><option value="Pending">Pending</option><option value="Completed">Completed</option></select></div>}

            <div className="flex justify-end gap-2 border-t border-[var(--border-subtle)] pt-5">
              {editingMapping && <Button type="button" variant="outline" onClick={cancelEdit}>Cancel</Button>}
              <Button type="submit" icon={<Link2 size={15} />} disabled={!primaryName.trim() || !secondaryNames.trim()}>{editingMapping ? "Save update" : `Create mapping ${cardinality === "1:N" ? "requests" : "request"}`}</Button>
            </div>
          </form>
        </section>

        <section className="space-y-3"><div className="flex flex-wrap gap-2"><Button size="sm" variant={scope === "team" ? "primary" : "outline"} onClick={() => setScope("team")}>All team</Button><Button size="sm" variant={scope === "mine" ? "primary" : "outline"} onClick={() => setScope("mine")}>My completed</Button><Button size="sm" variant={scope === "logged" ? "primary" : "outline"} onClick={() => setScope("logged")}>Logged by me</Button><input className="field-control max-w-xs" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search mapping or employee" />{isAdmin && <><select className="field-control max-w-40" value={actorDimension} onChange={(e) => setActorDimension(e.target.value as "mapped_by" | "requested_by")}><option value="mapped_by">Completed by</option><option value="requested_by">Logged by</option></select><select className="field-control max-w-48" value={actorId} onChange={(e) => setActorId(e.target.value)}><option value="">All employees</option>{actorOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></>}</div>
        <QueueList
          title="Mapping work queue"
          items={visibleMappings.map((mapping) => ({
            id: mapping.request_id,
            primaryNode: (
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--text-muted)]">Retailer → Distributor</p>
                <p className="mt-1.5 text-[13px] font-semibold leading-5 text-[var(--text-primary)]">{formatIdentity(mapping.retailer_name_unregistered, mapping.retailer_lead_id, "Retailer")}</p>
                <p className="mt-1 flex items-center gap-2 text-[12px] text-[var(--text-secondary)]"><ArrowRightLeft size={12} className="text-[var(--brand-600)]" /> {formatIdentity(mapping.distributor_name_unregistered, mapping.distributor_lead_id, "Distributor")}</p>
                <p className="mt-1 text-[12px] text-[var(--text-secondary)]">Logged by: {userLabel(mapping.requested_by, mapping.requested_by_name_snapshot, mapping.requested_by_id_snapshot)}</p><p className="mt-1 text-[12px] text-[var(--text-secondary)]">Completed by: {mapping.status === "Completed" ? userLabel(mapping.mapped_by, mapping.mapped_by_name_snapshot, mapping.mapped_by_id_snapshot) : "—"}</p>
              </div>
            ),
            statusText: mapping.status,
            statusVariant: mapping.status === "Completed" ? "success" : "warning",
            timestamp: new Date(mapping.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
            actions: mapping.requested_by === currentUser?.user_id ? (
              <Button size="sm" variant="outline" onClick={() => editMapping(mapping)}>Update</Button>
            ) : mapping.status === "Completed" ? (
              <Chip variant="success" size="sm"><CheckCircle2 size={10} /> Verified</Chip>
            ) : undefined,
          }))}
          emptyMessage="No mapping requests have been created."
          onRefresh={loadData}
        />
        </section>
      </div>
    </div>
  );
}
