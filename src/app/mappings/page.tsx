"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db, transactionalMutation, LocalLead, LocalMappingRequest } from "@/lib/db";
import { AlertCircle, CheckCircle2, Clock, Link2, RefreshCw, Download, ArrowRightLeft } from "lucide-react";
import { SearchableSelect, SearchableOption } from "@/components/SearchableSelect";
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
    label: `[${eu.username}] - ${eu.name || "Unknown"}`,
    searchText: eu.username + " " + eu.name
  })), []);

  const distributorOptions = React.useMemo(() => {
    const dbOptions: SearchableOption[] = leads.filter(l => l.segment_type === "Distributor").map(l => ({ value: l.lead_id, label: l.business_name }));
    const map = new Map<string, SearchableOption>();
    dbOptions.forEach(opt => map.set(opt.label.toLowerCase(), opt));
    excelOptions.forEach(opt => {
      // Don't duplicate if business name matches exactly
      const rawName = opt.value.split("::")[2]?.toLowerCase();
      if (!map.has(rawName)) map.set(rawName, opt);
    });
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [leads, excelOptions]);

  const retailerOptions = React.useMemo(() => {
    const dbOptions: SearchableOption[] = leads.filter(l => l.segment_type === "Retailer").map(l => ({ value: l.lead_id, label: l.business_name }));
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
      // Fallback JS-side sort in case Dexie index on created_at fails on un-migrated local DBs
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
    
    // If it's already an existing UUID
    const existing = leads.find(l => l.lead_id === input);
    if (existing) return existing.lead_id;

    let bName = input;
    if (input.startsWith("EXCEL::")) {
      const parts = input.split("::");
      bName = parts[2] || parts[1];
    }

    // Attempt name match
    const nameMatch = leads.find(l => l.business_name.toLowerCase() === bName.trim().toLowerCase() && l.segment_type === segmentType);
    if (nameMatch) return nameMatch.lead_id;

    // Create new lead dynamically
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
      const idempotencyBase = crypto.randomUUID();

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

  const getDistributorName = (map: LocalMappingRequest) => {
    return leads.find(l => l.lead_id === map.distributor_lead_id)?.business_name || "Unknown/Legacy Distributor";
  };
  
  const getRetailerName = (map: LocalMappingRequest) => {
    return leads.find(l => l.lead_id === map.retailer_lead_id)?.business_name || "Unknown/Legacy Retailer";
  };

  if (!hasSupport) {
    return (
      <div className="max-w-md mx-auto mt-16 p-8 bg-white rounded-3xl border border-slate-100 shadow-sm text-center space-y-4">
        <AlertCircle size={40} className="mx-auto text-status-error" />
        <h3 className="text-lg font-black text-slate-900">Access Restricted</h3>
        <p className="text-xs text-slate-500 font-semibold">You don't have a Support capability assigned.</p>
      </div>
    );
  }

  const primaryLabel = activeSegment;
  const secondaryLabel = activeSegment === "Distributor" ? "Retailer" : "Distributor";

  return (
    <div className="space-y-6 w-full">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Link2 size={20} className="text-brand-primary" />
          <div>
            <h2 className="text-2xl font-black text-slate-900">Distributor-Retailer Mappings</h2>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
              Manage client linkages
            </p>
          </div>
        </div>
        
        <button
          onClick={() => {
            import('@/lib/excelExport').then(m => m.exportMasterMappings());
          }}
          className="flex items-center gap-1.5 px-3 py-2 bg-brand-primary text-white rounded-xl text-xs font-black cursor-pointer hover:bg-brand-secondary transition-all w-fit"
        >
          <Download size={14} /> Download Mapping Data
        </button>
      </div>

      {successMsg && <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-700 text-xs font-bold">✓ {successMsg}</div>}
      {errorMsg   && <div className="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-rose-600 text-xs font-bold flex gap-2 items-center"><AlertCircle size={14}/>{errorMsg}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-2 bg-white rounded-3xl border border-slate-100 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
              <Link2 size={16} className="text-brand-primary" />
              Log Mapping Task
            </h3>
          </div>
          
          {/* Segment & Cardinality Toggles */}
          <div className="space-y-3 pb-2 border-b border-slate-100">
            <div className="flex gap-2 p-1 bg-slate-100 rounded-xl">
              <button
                onClick={() => setActiveSegment("Distributor")}
                className={`flex-1 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer ${activeSegment === "Distributor" ? "bg-white text-brand-primary shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
              >
                From Distributor
              </button>
              <button
                onClick={() => setActiveSegment("Retailer")}
                className={`flex-1 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer ${activeSegment === "Retailer" ? "bg-white text-brand-primary shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
              >
                From Retailer
              </button>
            </div>
            
            <div className="flex gap-2 p-1 bg-slate-100 rounded-xl">
              <button
                onClick={() => setCardinality("1:1")}
                className={`flex-1 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer ${cardinality === "1:1" ? "bg-white text-brand-primary shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
              >
                One-to-One
              </button>
              <button
                onClick={() => setCardinality("1:N")}
                className={`flex-1 py-1.5 rounded-lg text-xs font-black transition-all cursor-pointer ${cardinality === "1:N" ? "bg-white text-brand-primary shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
              >
                One-to-Many
              </button>
            </div>
          </div>

          <form onSubmit={handleLogMapping} className="space-y-4 pt-2">
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
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
               <ArrowRightLeft size={16} className="text-slate-400 rotate-90" />
            </div>

            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
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
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold text-slate-900 placeholder-slate-300 focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10 transition-all resize-none"
                  required
                />
              )}
            </div>

            <button
              type="submit"
              className="w-full py-3.5 bg-brand-primary hover:bg-brand-secondary text-white font-black rounded-2xl transition-all shadow-md shadow-brand-primary/10 text-xs tracking-wider uppercase cursor-pointer"
            >
              Log Mapping Task
            </button>
          </form>
        </div>

        <div className="lg:col-span-3 bg-white rounded-3xl border border-slate-100 shadow-sm p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
              <Clock size={16} className="text-brand-secondary" /> Mapping Queue
            </h3>
            <button onClick={loadData} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 cursor-pointer" title="Refresh">
              <RefreshCw size={14} />
            </button>
          </div>

          <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
            {mappings.length === 0 && (
              <p className="text-xs italic text-slate-400 text-center py-10 font-semibold">No mappings recorded.</p>
            )}
            {mappings.map(map => (
              <div
                key={map.request_id}
                className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-3 hover:border-slate-200 transition-all"
              >
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <p className="text-sm font-bold text-slate-900 mt-0.5 leading-snug">
                      {getRetailerName(map)} <span className="text-slate-400 font-normal mx-1">→</span> {getDistributorName(map)}
                    </p>
                  </div>
                  <span className={`shrink-0 text-[9px] font-black uppercase px-2 py-0.5 rounded-full border ${map.status === "Completed" ? "bg-emerald-50 text-emerald-600 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>
                    {map.status}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400 font-semibold border-t border-slate-200/50 pt-2">
                  <span>{new Date(map.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                  {map.status !== "Completed" && (
                    <button
                      onClick={() => handleUpdateMappingStatus(map.request_id, "Completed")}
                      className="px-2.5 py-1 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-lg text-[10px] font-black hover:bg-emerald-100 transition-all cursor-pointer"
                    >
                      Mark Complete ✓
                    </button>
                  )}
                  {map.status === "Completed" && (
                    <span className="text-emerald-500 font-black flex items-center gap-1"><CheckCircle2 size={10}/> Done</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
