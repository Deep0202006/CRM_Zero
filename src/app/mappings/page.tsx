"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db, transactionalMutation, LocalLead, LocalMappingRequest } from "@/lib/db";
import { AlertCircle, CheckCircle2, Link2, Download, ArrowRightLeft } from "lucide-react";
import { SearchableSelect, SearchableOption } from "@/components/SearchableSelect";
import { QueueList } from "@/components/QueueList";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
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

  const excelOptions: SearchableOption[] = React.useMemo(() => excelUsers.map((eu: any) => ({
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
      const updates: any = { status: newStatus };
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
      <Card className="max-w-md mx-auto mt-16 text-center space-y-4 p-8">
        <AlertCircle size={40} className="mx-auto text-[var(--status-danger)]" />
        <h3 className="text-base font-black text-[var(--text-primary)]">Access Restricted</h3>
        <p className="text-xs text-[var(--text-muted)] font-semibold">You don't have Support capabilities assigned.</p>
      </Card>
    );
  }

  const primaryLabel = activeSegment;
  const secondaryLabel = activeSegment === "Distributor" ? "Retailer" : "Distributor";

  return (
    <div className="space-y-6 w-full max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Link2 size={24} className="text-[var(--brand-500)]" />
          <div>
            <h1 className="text-2xl font-black text-[var(--text-primary)]">Distributor-Retailer Mappings</h1>
            <p className="text-xs text-[var(--text-muted)] font-bold uppercase tracking-wider">
              Manage client linkages
            </p>
          </div>
        </div>
        
        <Button
          size="sm"
          onClick={() => {
            import('@/lib/excelExport').then(m => m.exportMasterMappings());
          }}
          icon={<Download size={14} />}
        >
          Download Mapping Data
        </Button>
      </div>

      {successMsg && <div className="p-4 bg-[var(--status-success-soft)] border border-[var(--status-success)]/20 rounded-[var(--radius-lg)] text-[var(--status-success)] text-xs font-bold">✓ {successMsg}</div>}
      {errorMsg   && <div className="p-4 bg-[var(--status-danger-soft)] border border-[var(--status-danger)]/20 rounded-[var(--radius-lg)] text-[var(--status-danger)] text-xs font-bold flex gap-2 items-center"><AlertCircle size={14}/>{errorMsg}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <Card className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] pb-3">
            <h2 className="text-sm font-black text-[var(--text-primary)] flex items-center gap-2">
              <Link2 size={16} className="text-[var(--brand-500)]" />
              Log Mapping Task
            </h2>
          </div>
          
          {/* Segment & Cardinality Toggles */}
          <div className="space-y-3 pb-2 border-b border-[var(--border-subtle)]">
            <div className="flex gap-1.5 p-1 bg-[var(--surface-secondary)] rounded-[var(--radius-md)]">
              <button
                onClick={() => setActiveSegment("Distributor")}
                className={`flex-1 py-1.5 rounded-[var(--radius-sm)] text-xs font-bold transition-all cursor-pointer ${
                  activeSegment === "Distributor" ? "bg-[var(--surface-primary)] text-[var(--brand-500)] shadow-xs" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                From Distributor
              </button>
              <button
                onClick={() => setActiveSegment("Retailer")}
                className={`flex-1 py-1.5 rounded-[var(--radius-sm)] text-xs font-bold transition-all cursor-pointer ${
                  activeSegment === "Retailer" ? "bg-[var(--surface-primary)] text-[var(--brand-500)] shadow-xs" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                From Retailer
              </button>
            </div>
            
            <div className="flex gap-1.5 p-1 bg-[var(--surface-secondary)] rounded-[var(--radius-md)]">
              <button
                onClick={() => setCardinality("1:1")}
                className={`flex-1 py-1.5 rounded-[var(--radius-sm)] text-xs font-bold transition-all cursor-pointer ${
                  cardinality === "1:1" ? "bg-[var(--surface-primary)] text-[var(--brand-500)] shadow-xs" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                One-to-One
              </button>
              <button
                onClick={() => setCardinality("1:N")}
                className={`flex-1 py-1.5 rounded-[var(--radius-sm)] text-xs font-bold transition-all cursor-pointer ${
                  cardinality === "1:N" ? "bg-[var(--surface-primary)] text-[var(--brand-500)] shadow-xs" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                One-to-Many
              </button>
            </div>
          </div>

          <form onSubmit={handleLogMapping} className="space-y-4 pt-2">
            <div>
              <label className="block text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest mb-1.5">
                Primary {primaryLabel}
              </label>
              <SearchableSelect
                options={activeSegment === "Distributor" ? distributorOptions : retailerOptions}
                value={primaryName}
                onChange={setPrimaryName}
                placeholder={`Type ${primaryLabel.toLowerCase()} name...`}
                required
              />
            </div>

            <div className="flex justify-center -my-2 opacity-50">
               <ArrowRightLeft size={16} className="text-[var(--text-muted)] rotate-90" />
            </div>

            <div>
              <label className="block text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest mb-1.5">
                Secondary {secondaryLabel}{cardinality === "1:N" ? "s (Comma Separated)" : ""}
              </label>
              {cardinality === "1:1" ? (
                <SearchableSelect
                  options={activeSegment === "Distributor" ? retailerOptions : distributorOptions}
                  value={secondaryNames}
                  onChange={setSecondaryNames}
                  placeholder={`Type ${secondaryLabel.toLowerCase()} name...`}
                  required
                />
              ) : (
                <textarea
                  value={secondaryNames}
                  onChange={e => setSecondaryNames(e.target.value)}
                  placeholder={`e.g. ${secondaryLabel} 1, ${secondaryLabel} 2, ${secondaryLabel} 3`}
                  rows={3}
                  className="w-full bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-[var(--radius-md)] p-3 text-xs font-medium text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--brand-500)] focus:ring-2 focus:ring-[var(--brand-500)]/20 transition-all resize-none"
                  required
                />
              )}
            </div>

            <Button
              type="submit"
              className="w-full h-11"
            >
              Log Mapping Task
            </Button>
          </form>
        </Card>

        <QueueList
          title="Mapping Queue"
          items={mappings.map(map => ({
            id: map.request_id,
            primaryNode: (
              <p className="text-xs font-bold text-[var(--text-primary)] leading-snug">
                {formatIdentity(map.retailer_lead_id, "Retailer")}
                <span className="text-[var(--text-muted)] font-normal mx-1">→</span>
                {formatIdentity(map.distributor_lead_id, "Distributor")}
              </p>
            ),
            statusText: map.status,
            statusVariant: map.status === "Completed" ? "success" : "warning",
            timestamp: new Date(map.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
            actions: map.status !== "Completed" ? (
              <Button
                size="sm"
                variant="success"
                onClick={() => handleUpdateMappingStatus(map.request_id, "Completed")}
              >
                Mark Complete ✓
              </Button>
            ) : (
              <Chip variant="success" size="sm">
                <CheckCircle2 size={10}/> Done
              </Chip>
            )
          }))}
          emptyMessage="No mappings recorded."
          onRefresh={loadData}
        />
      </div>
    </div>
  );
}
