"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db, LocalLead, LocalMappingRequest } from "@/lib/db";
import { AlertCircle, CheckCircle2, Clock, Link2, RefreshCw, Download } from "lucide-react";
import { SearchableSelect } from "@/components/SearchableSelect";

export default function MappingsPage() {
  const { currentUser, hasSupport } = useAuth();
  const [leads, setLeads] = useState<LocalLead[]>([]);
  const [mappings, setMappings] = useState<LocalMappingRequest[]>([]);
  
  const [mapDistId, setMapDistId] = useState("");
  const [mapRetId, setMapRetId] = useState("");
  
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
    if (!mapDistId || !mapRetId) {
      setErrorMsg("Select both a distributor and retailer.");
      return;
    }
    try {
      const newMapping: LocalMappingRequest = {
        request_id: crypto.randomUUID(),
        distributor_lead_id: mapDistId,
        retailer_lead_id: mapRetId,
        status: "Pending",
        mapped_by: currentUser?.user_id || "system",
        created_at: new Date().toISOString(),
      };
      await db.mapping_requests.add(newMapping);
      await db.sync_queue.add({ idempotency_key: crypto.randomUUID(),  table_name: "mapping_requests", action: "INSERT", data: newMapping, timestamp: new Date().toISOString() });

      setSuccessMsg("Mapping task logged.");
      setTimeout(() => setSuccessMsg(null), 2500);
      setMapDistId("");
      setMapRetId("");
      await loadData();
    } catch (err) {
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

  const getLeadName = (id: string) => leads.find(l => l.lead_id === id)?.business_name || "Unknown";

  if (!hasSupport) {
    return (
      <div className="max-w-md mx-auto mt-16 p-8 bg-white rounded-3xl border border-slate-100 shadow-sm text-center space-y-4">
        <AlertCircle size={40} className="mx-auto text-status-error" />
        <h3 className="text-lg font-black text-slate-900">Access Restricted</h3>
        <p className="text-xs text-slate-500 font-semibold">You don't have a Support capability assigned.</p>
      </div>
    );
  }

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
          <h3 className="text-base font-black text-slate-900 flex items-center gap-2">
            <Link2 size={16} className="text-brand-primary" />
            Log Mapping Task
          </h3>

          <form onSubmit={handleLogMapping} className="space-y-4">
            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                Distributor
              </label>
              <SearchableSelect
                options={leads.filter(l => l.segment_type === "Distributor").map(l => ({ value: l.lead_id, label: l.business_name }))}
                value={mapDistId}
                onChange={setMapDistId}
                placeholder="— Search Distributor —"
                required
              />
            </div>

            <div>
              <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                Retailer
              </label>
              <SearchableSelect
                options={leads.filter(l => l.segment_type === "Retailer").map(l => ({ value: l.lead_id, label: l.business_name }))}
                value={mapRetId}
                onChange={setMapRetId}
                placeholder="— Search Retailer —"
                required
              />
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
                      {getLeadName(map.retailer_lead_id)} <span className="text-slate-400 font-normal mx-1">→</span> {getLeadName(map.distributor_lead_id)}
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
