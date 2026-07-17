"use client";

import React, { useState, useEffect } from "react";
import { UploadCloud, CheckCircle2, AlertCircle, Loader2, Users, MapPin } from "lucide-react";
import { db, LocalUser } from "@/lib/db";
import { useAuth } from "@/context/AuthContext";
import { supabase } from "@/lib/supabaseClient";

interface UploadResponse {
  success?: boolean;
  filename?: string;
  hash?: string;
  cities?: string[];
  rows?: any[];
  totalParsed?: number;
  error?: string;
}

export function TaskAllocationWorkspace() {
  const { currentUser } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadData, setUploadData] = useState<UploadResponse | null>(null);
  const [agents, setAgents] = useState<LocalUser[]>([]);
  const [cityAgentMap, setCityAgentMap] = useState<Record<string, string>>({});
  const [allocating, setAllocating] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    const loadAgents = async () => {
      try {
        const { data, error } = await supabase.from("users").select("*").eq("is_active", 1);
        if (error) throw error;
        if (data) {
          setAgents(data);
          await db.users.bulkPut(data); // keep local cache updated
        }
      } catch (err) {
        console.error("Failed to load agents from Supabase, falling back to local DB", err);
        const allUsers = await db.users.filter(u => u.is_active === 1).toArray();
        setAgents(allUsers);
      }
    };
    loadAgents();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setUploadData(null);
      setMessage(null);
      setCityAgentMap({});
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setMessage(null);
    setCityAgentMap({});

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/task-upload", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (res.ok) {
        setUploadData(data);
        setMessage({ type: "success", text: `Parsed ${data.totalParsed} targets across ${data.cities.length} cities.` });
      } else {
        setMessage({ type: "error", text: data.error || "Upload failed" });
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "An error occurred during upload" });
    } finally {
      setUploading(false);
    }
  };

  const handleAgentSelect = (city: string, agentId: string) => {
    setCityAgentMap(prev => {
      const next = { ...prev };
      if (!agentId) {
        delete next[city];
      } else {
        next[city] = agentId;
      }
      return next;
    });
  };

  const handleAllocate = async () => {
    const citiesToAllocate = Object.entries(cityAgentMap);
    if (citiesToAllocate.length === 0 || !uploadData) return;
    
    setAllocating(true);
    setMessage(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      let totalAllocated = 0;
      let errors = [];

      for (const [city, assigned_to_user_id] of citiesToAllocate) {
        const res = await fetch("/api/task-allocate", {
          method: "POST",
          headers: { 
            "Content-Type": "application/json",
            "Authorization": session ? `Bearer ${session.access_token}` : ""
          },
          body: JSON.stringify({
            city,
            assigned_to_user_id,
            rows: uploadData.rows,
            filename: uploadData.filename,
            hash: uploadData.hash,
            admin_id: currentUser?.user_id
          }),
        });

        const data = await res.json();
        if (res.ok) {
          totalAllocated += data.allocatedCount;
        } else {
          errors.push(`Failed for ${city}: ${data.error}`);
        }
      }

      if (errors.length > 0) {
        setMessage({ type: "error", text: `Allocated ${totalAllocated} tasks, but had errors: ${errors.join(", ")}` });
      } else {
        setMessage({ type: "success", text: `Successfully allocated ${totalAllocated} tasks across ${citiesToAllocate.length} cities!` });
        setCityAgentMap({});
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err.message || "An error occurred during allocation" });
    } finally {
      setAllocating(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
      <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
        <UploadCloud className="h-5 w-5 text-indigo-600" />
        Excel Bulk Task Allocation
      </h2>

      <div className="space-y-6">
        {/* Upload Zone */}
        <div className="border-2 border-dashed border-slate-200 rounded-lg p-6 text-center hover:bg-slate-50 transition-colors">
          <input
            type="file"
            accept=".xlsx, .xls, .csv"
            onChange={handleFileChange}
            className="hidden"
            id="excel-upload"
          />
          <label htmlFor="excel-upload" className="cursor-pointer flex flex-col items-center justify-center">
            <UploadCloud className="h-10 w-10 text-slate-400 mb-2" />
            <span className="text-sm font-medium text-slate-700">
              {file ? file.name : "Click to upload Excel/CSV file"}
            </span>
            <span className="text-xs text-slate-500 mt-1">Expected columns: Username, Name, Address, Area, City, State, Mobile, Email, PSPACode, Third-Party Code, Dlic1-4, FoodLicense</span>
          </label>

          {file && !uploadData && (
            <button
              onClick={handleUpload}
              disabled={uploading}
              className="mt-4 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 inline-flex items-center gap-2"
            >
              {uploading && <Loader2 className="h-4 w-4 animate-spin" />}
              {uploading ? "Parsing File..." : "Parse Spreadsheet"}
            </button>
          )}
        </div>

        {/* Message Banner */}
        {message && (
          <div className={`p-4 rounded-lg flex items-center gap-3 text-sm font-medium ${
            message.type === "success" ? "bg-emerald-50 text-emerald-800 border border-emerald-200" : "bg-rose-50 text-rose-800 border border-rose-200"
          }`}>
            {message.type === "success" ? <CheckCircle2 className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
            {message.text}
          </div>
        )}

        {/* City-wise Allocation Controls */}
        {uploadData && uploadData.success && uploadData.cities && (
          <div className="pt-4 border-t border-slate-100">
            <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
              <MapPin className="h-4 w-4 text-slate-400" /> Map Cities to Agents
            </h3>
            
            <div className="space-y-3 max-h-96 overflow-y-auto pr-2">
              {uploadData.cities.map(city => {
                const cityCount = uploadData.rows?.filter((r: any) => r.city === city).length || 0;
                return (
                  <div key={city} className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-slate-50 border border-slate-200 rounded-lg gap-3">
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-slate-800">{city}</span>
                      <span className="text-xs font-medium text-slate-500">{cityCount} target{cityCount !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="w-full sm:w-64 shrink-0">
                      <select
                        value={cityAgentMap[city] || ""}
                        onChange={(e) => handleAgentSelect(city, e.target.value)}
                        className="w-full h-9 px-3 bg-white border border-slate-200 rounded-md text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="">Do not assign</option>
                        {agents.map(agent => (
                          <option key={agent.user_id} value={agent.user_id}>{agent.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
            
            <div className="flex justify-end mt-6">
              <button
                onClick={handleAllocate}
                disabled={allocating || Object.keys(cityAgentMap).length === 0}
                className="px-6 py-2.5 bg-emerald-600 text-white text-sm font-bold rounded-lg hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center gap-2 shadow-sm"
              >
                {allocating && <Loader2 className="h-4 w-4 animate-spin" />}
                {allocating ? "Allocating Tasks..." : `Allocate ${Object.keys(cityAgentMap).length} Cities`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
