"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/db";
import { ShieldAlert, Mail, Lock, Sparkles, LogIn } from "lucide-react";

export default function LoginPage() {
  const { currentUser, login, isLoading } = useAuth();
  
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // If already logged in, redirect: /my-day if clocked in today, otherwise /attendance
  useEffect(() => {
    if (!currentUser) return;
    const todayStr = new Date().toISOString().slice(0, 10);
    db.attendance
      .where("[user_id+date]")
      .equals([currentUser.user_id, todayStr])
      .first()
      .then((record) => {
        window.location.href = record ? "/my-day" : "/attendance";
      })
      .catch(() => {
        window.location.href = "/attendance";
      });
  }, [currentUser]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!email.trim() || !password.trim()) {
      setErrorMsg("Corporate email and access password are required.");
      return;
    }

    const success = await login(email, password);
    if (success) {
      // Go to attendance page for clock-in; login effect will skip if already clocked in today
      window.location.href = "/attendance";
    } else {
      setErrorMsg("Invalid email address or corporate password.");
    }
  };

  const presets = [
    { name: "Alice (Admin)", email: "alice@crm.org", role: "Full Access & KPI Dashboard" },
    { name: "Bob (Retailer Support)", email: "bob@crm.org", role: "Retailer Queries & Mappings" },
    { name: "Charlie (Distributor Support)", email: "charlie@crm.org", role: "Distributor Queries & Mappings" },
    { name: "Daisy (Retailer Onboarding)", email: "daisy@crm.org", role: "Retailer Sales Onboarding" },
    { name: "Frank (Distributor Onboarding)", email: "frank@crm.org", role: "Distributor Sales Onboarding" },
    { name: "Grace (Tech Support)", email: "grace@crm.org", role: "IT Ticket Queue Resolution" }
  ];

  return (
    <div className="min-h-screen bg-canvas flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* Background glowing gradients */}
      <div className="absolute top-1/4 left-1/4 h-[300px] w-[300px] rounded-full bg-brand-primary/5 blur-[100px] pointer-events-none"></div>
      <div className="absolute bottom-1/4 right-1/4 h-[300px] w-[300px] rounded-full bg-brand-secondary/5 blur-[100px] pointer-events-none"></div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="flex justify-center mb-8">
          <img
            src="/ZeroData_Logo.png"
            alt="ZeroData - Your data is yours"
            className="h-14 w-auto object-contain"
          />
        </div>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10 px-4 sm:px-0">
        <div className="bg-white py-8 px-6 border border-slate-100 rounded-3xl shadow-xl space-y-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            {errorMsg && (
              <div className="flex items-center gap-2 bg-status-error/10 border border-status-error/20 text-status-error p-3.5 rounded-xl text-xs font-semibold">
                <ShieldAlert size={16} className="shrink-0" />
                <span>{errorMsg}</span>
              </div>
            )}

            <div>
              <label htmlFor="email" className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                Corporate Email Address
              </label>
              <div className="relative">
                <Mail size={16} className="absolute left-3.5 top-3.5 text-slate-400" />
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@company.org"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10 transition-all font-semibold"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                Access Password
              </label>
              <div className="relative">
                <Lock size={16} className="absolute left-3.5 top-3.5 text-slate-400" />
                <input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/10 transition-all font-semibold"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full mt-2 flex items-center justify-center gap-2 py-3 px-4 bg-brand-primary hover:bg-brand-secondary text-white rounded-xl text-xs font-black tracking-wider uppercase transition-all shadow-md shadow-brand-primary/10 disabled:opacity-50 cursor-pointer"
            >
              <LogIn size={16} />
              {isLoading ? "Validating Session..." : "Log In to Workspace"}
            </button>
          </form>

          {process.env.NEXT_PUBLIC_SHOW_PRESETS === "true" && (
            <div className="border-t border-slate-100 pt-6">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 justify-center">
                <Sparkles size={14} className="text-brand-primary" />
                <span>Reviewer Presets</span>
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {presets.map((preset) => (
                  <button
                    key={preset.email}
                    type="button"
                    onClick={() => {
                      setEmail(preset.email);
                      setPassword("password123");
                      setErrorMsg(null);
                    }}
                    className="p-3 text-left bg-slate-50 hover:bg-brand-primary/5 hover:border-brand-primary/20 border border-slate-200/60 rounded-xl transition-all flex flex-col justify-between text-xs cursor-pointer group"
                  >
                    <span className="font-black text-slate-950 block group-hover:text-brand-primary transition-colors">{preset.name}</span>
                    <span className="text-[10px] text-slate-400 block truncate font-semibold mt-0.5">{preset.role}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
