"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db, LocalLead, LocalMappingRequest } from "@/lib/db";
import { AlertCircle, CheckCircle2, Clock, Link2, RefreshCw, Download, ArrowRightLeft } from "lucide-react";

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

  const loadData = async () => {
    try {
      const allLeads = await db.leads.toArray();
      setLeads(allLeads);
      const allMaps = await db.mapping_requests.orderBy("created_at").reverse().toArray();
      setMappings(allMaps);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleLogMapping = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!primaryName.trim() || !secondaryNames.trim()) {
      setErrorMsg("Please provide both primary and secondary names.");
      return;
    }
    
    try {
      // Find primary lead match
      const pMatch = leads.find(l => l.business_name.toLowerCase() === primaryName.trim().toLowerCase() && l.segment_type === activeSegment);
      
      // Parse secondary names
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
        const sMatch = leads.find(l => l.business_name.toLowerCase() === sName.toLowerCase() && l.segment_type === secondarySegment);
        
        const isDistPrimary = activeSegment === "Distributor";
        
        const newMapping: LocalMappingRequest = {
          request_id: crypto.randomUUID(),
          distributor_lead_id: isDistPrimary ? (pMatch ? pMatch.lead_id : null) : (sMatch ? sMatch.lead_id : null),
          retailer_lead_id: isDistPrimary ? (sMatch ? sMatch.lead_id : null) : (pMatch ? pMatch.lead_id : null),
          distributor_name_unregistered: isDistPrimary ? (pMatch ? null : primaryName.trim()) : (sMatch ? null : sName),
          retailer_name_unregistered: isDistPrimary ? (sMatch ? null : sName) : (pMatch ? null : primaryName.trim()),
          status: "Pending",
          mapped_by: currentUser?.user_id || "system",
          created_at: timestamp,
        };
        newMaps.push(newMapping);
      }
      
      await db.mapping_requests.bulkAdd(newMaps);
      
      // Queue syncs
      for (let i = 0; i < newMaps.length; i++) {
         await db.sync_queue.add({ 
           idempotency_key: `${idempotencyBase}-${i}`, 
           table_name: "mapping_requests", 
           action: "INSERT", 
           data: newMaps[i], 
           timestamp: timestamp 
         });
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
      await db.mapping_requests.update(request_id, updates);
      await db.sync_queue.add({ idempotency_key: crypto.randomUUID(),  table_name: "mapping_requests", action: "UPDATE", data: { request_id, ...updates }, timestamp: new Date().toISOString() });
      await loadData();
    } catch (err) {
      setErrorMsg("Failed to update mapping status.");
    }
  };

  const getDistributorName = (map: LocalMappingRequest) => {
    if (map.distributor_lead_id) return leads.find(l => l.lead_id === map.distributor_lead_id)?.business_name || "Unknown";
    return map.distributor_name_unregistered || "Unknown";
  };
  
  const getRetailerName = (map: LocalMappingRequest) => {
    if (map.retailer_lead_id) return leads.find(l => l.lead_id === map.retailer_lead_id)?.business_name || "Unknown";
    return map.retailer_name_unregistered || "Unknown";
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
              <input
                type="text"
                value={primaryName}
                onChange={e => setPrimaryName(e.target.value)}
                placeholder={`Type ${primaryLabel.toLowerCase()} name...`}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold text-slate-900 placeholder-slate-300 focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10 transition-all"
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
                <input
                  type="text"
                  value={secondaryNames}
                  onChange={e => setSecondaryNames(e.target.value)}
                  placeholder={`Type ${secondaryLabel.toLowerCase()} name...`}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold text-slate-900 placeholder-slate-300 focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10 transition-all"
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
