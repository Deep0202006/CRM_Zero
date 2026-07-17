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
  const [selectedCity, setSelectedCity] = useState("");
  const [selectedAgent, setSelectedAgent] = useState("");
  const [allocating, setAllocating] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    // Load agents from DB
    const loadAgents = async () => {
      try {
        const allUsers = await db.users.filter(u => u.is_active === 1).toArray();
        // Assume any active user can be assigned for now
        setAgents(allUsers);
      } catch (err) {
        console.error("Failed to load agents", err);
      }
    };
    loadAgents();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      setUploadData(null);
      setMessage(null);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setMessage(null);

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

  const handleAllocate = async () => {
    if (!selectedCity || !selectedAgent || !uploadData) return;
    setAllocating(true);
    setMessage(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      const res = await fetch("/api/task-allocate", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": session ? `Bearer ${session.access_token}` : ""
        },
        body: JSON.stringify({
          city: selectedCity,
          assigned_to_user_id: selectedAgent,
          rows: uploadData.rows,
          filename: uploadData.filename,
          hash: uploadData.hash,
          admin_id: currentUser?.user_id
        }),
      });

      const data = await res.json();
      if (res.ok) {
        setMessage({ type: "success", text: `Successfully allocated ${data.allocatedCount} tasks in ${data.city}!` });
        // Optionally trigger a local sync to update Dexie
      } else {
        setMessage({ type: "error", text: data.error || "Allocation failed" });
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

        {/* Allocation Controls */}
        {uploadData && uploadData.success && uploadData.cities && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-slate-100">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center gap-2">
                <MapPin className="h-4 w-4 text-slate-400" /> Target City
              </label>
              <select
                value={selectedCity}
                onChange={(e) => setSelectedCity(e.target.value)}
                className="w-full h-10 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">Select a city...</option>
                {uploadData.cities.map(city => (
                  <option key={city} value={city}>{city}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1 flex items-center gap-2">
                <Users className="h-4 w-4 text-slate-400" /> Assign To Agent
              </label>
              <select
                value={selectedAgent}
                onChange={(e) => setSelectedAgent(e.target.value)}
                className="w-full h-10 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">Select an agent...</option>
                {agents.map(agent => (
                  <option key={agent.user_id} value={agent.user_id}>{agent.name}</option>
                ))}
              </select>
            </div>
            
            <div className="md:col-span-2 flex justify-end mt-2">
              <button
                onClick={handleAllocate}
                disabled={allocating || !selectedCity || !selectedAgent}
                className="px-6 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center gap-2"
              >
                {allocating && <Loader2 className="h-4 w-4 animate-spin" />}
                {allocating ? "Allocating..." : "Execute Bulk Allocation"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
