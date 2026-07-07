"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

const CAPABILITY_LABELS: Record<string, string> = {
  admin: "Admin", task_assigner: "Task Assigner", dist_onboarding: "Distributor Sales", dist_support: "Distributor Support",
  ret_onboarding: "Retailer Sales", ret_support: "Retailer Support",
  field_dist: "Field Sales (Distributor)", field_ret: "Field Sales (Retailer)", tech_support: "Technical Support",
};

export function CreateUserPanel() {
  const [form, setForm] = useState({ email: "", name: "", password: "", capabilities: [] as string[] });
  const [result, setResult] = useState<{ email: string; tempPassword: string; name: string } | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();

      const res = await fetch("/api/admin/create-user", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error?.formErrors?.join(", ") || data.error || "Failed to create user"); return; }

      setResult(data);
      setForm({ email: "", name: "", password: "", capabilities: [] });
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  }

  if (result) {
    return (
      <div className="p-6 bg-amber-50 rounded-xl border border-amber-200 shadow-sm max-w-lg">
        <h3 className="mb-2 font-black text-amber-900 text-lg">Account created — save this now</h3>
        <p className="text-sm text-amber-800">This password will not be shown again. Share it with {result.name} securely, not over email or chat.</p>
        <div className="mt-4 p-4 bg-white rounded-lg font-mono text-sm border border-amber-200">
          <div className="mb-2"><strong>Username:</strong> {result.email}</div>
          <div><strong>Temporary password:</strong> {result.tempPassword}</div>
        </div>
        <button onClick={() => setResult(null)} className="mt-4 px-4 py-2 bg-amber-100 text-amber-900 hover:bg-amber-200 font-bold rounded-lg text-sm transition-colors border border-amber-300">
          Create another
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5 max-w-lg bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
      <div>
        <label className="block text-sm font-bold text-slate-700 mb-1">Full Name</label>
        <input required placeholder="E.g., Jane Doe" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary/50 text-sm" />
      </div>
      <div>
        <label className="block text-sm font-bold text-slate-700 mb-1">Username</label>
        <input required type="text" placeholder="e.g. zerodata501_Deep" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary/50 text-sm" />
      </div>
      <div>
        <label className="block text-sm font-bold text-slate-700 mb-1">Set Password <span className="text-slate-400 font-normal">(Optional)</span></label>
        <input type="text" placeholder="Leave empty to auto-generate" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-primary/50 text-sm" />
      </div>
      <div>
        <div className="text-sm font-bold text-slate-700 mb-2">Roles (select all that apply)</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {Object.entries(CAPABILITY_LABELS).map(([code, label]) => (
            <label key={code} className="flex items-start gap-2 text-sm font-medium text-slate-600 cursor-pointer p-2 hover:bg-slate-50 rounded-lg border border-transparent hover:border-slate-200 transition-colors">
              <input
                type="checkbox"
                checked={form.capabilities.includes(code)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...form.capabilities, code]
                    : form.capabilities.filter((c) => c !== code);
                  setForm({ ...form, capabilities: next });
                }}
                className="mt-0.5 rounded text-brand-primary focus:ring-brand-primary w-4 h-4"
              />
              {label}
            </label>
          ))}
        </div>
      </div>
      {error && <div className="text-status-error text-sm font-bold p-3 bg-red-50 rounded-lg">{error}</div>}
      <button type="submit" disabled={!form.capabilities.length || isLoading} className="mt-2 px-4 py-3 bg-brand-primary text-white font-black rounded-xl hover:bg-brand-secondary disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm">
        {isLoading ? "Creating..." : "Create account"}
      </button>
    </form>
  );
}
