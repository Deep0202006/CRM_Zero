"use client";

import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { UserPlus, ShieldCheck, Copy, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

const CAPABILITY_LABELS: Record<string, string> = {
  admin: "Administrator",
  task_assigner: "Task assigner",
  dist_onboarding: "Distributor sales",
  dist_support: "Distributor support",
  ret_onboarding: "Retailer sales",
  ret_support: "Retailer support",
  field_dist: "Field sales · distributor",
  field_ret: "Field sales · retailer",
  tech_support: "Technical support",
};

export function CreateUserPanel() {
  const [form, setForm] = useState({ email: "", name: "", password: "", capabilities: [] as string[] });
  const [result, setResult] = useState<{ email: string; tempPassword: string; name: string } | null>(null);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setIsLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch("/api/admin/create-user", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error?.formErrors?.join(", ") || data.error || "Failed to create user");
        return;
      }
      setResult(data);
      setForm({ email: "", name: "", password: "", capabilities: [] });
    } catch (caughtError: unknown) {
      setError(caughtError instanceof Error ? caughtError.message : "An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  }

  const copyCredentials = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(`Username: ${result.email}\nTemporary password: ${result.tempPassword}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  if (result) {
    return (
      <section className="surface-panel overflow-hidden" aria-labelledby="account-created-title">
        <div className="border-b border-[var(--status-warning)]/20 bg-[var(--status-warning-soft)] p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--surface-primary)] text-[var(--status-warning)]"><CheckCircle2 size={19} /></span>
            <div><p className="section-kicker text-[var(--status-warning)]">Account created</p><h3 id="account-created-title" className="mt-1 text-lg font-semibold">Save the temporary credentials now</h3><p className="mt-1 text-[12px] leading-5 text-[var(--text-secondary)]">Share them with {result.name} using an approved secure channel. The password will not be shown again after closing this result.</p></div>
          </div>
        </div>
        <div className="max-w-2xl space-y-5 p-5 sm:p-6">
          <div className="grid gap-3 rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--surface-secondary)] p-4 sm:grid-cols-2">
            <div><p className="section-kicker">Username</p><p className="mt-2 break-all font-mono text-[13px] font-semibold text-[var(--text-primary)]">{result.email}</p></div>
            <div><p className="section-kicker">Temporary password</p><p className="mt-2 break-all font-mono text-[13px] font-semibold text-[var(--brand-700)]">{result.tempPassword}</p></div>
          </div>
          <div className="flex flex-wrap gap-2"><Button onClick={copyCredentials} icon={copied ? <CheckCircle2 size={14} /> : <Copy size={14} />}>{copied ? "Copied" : "Copy credentials"}</Button><Button variant="secondary" onClick={() => { setResult(null); setCopied(false); }}>Create another account</Button></div>
        </div>
      </section>
    );
  }

  return (
    <section className="surface-panel overflow-hidden" aria-labelledby="create-account-title">
      <div className="border-b border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--brand-100)] text-[var(--brand-800)]"><UserPlus size={18} /></span>
          <div><p className="section-kicker">Identity provisioning</p><h3 id="create-account-title" className="mt-1 section-title">Create a team account</h3><p className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">Create the identity and assign only the capabilities required for the person’s role.</p></div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="grid gap-6 p-5 sm:p-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="space-y-5">
          <Input label="Full name" required placeholder="Example: Jane Doe" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          <Input label="Username" required placeholder="Example: zerodata501_jane" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} description="Use the existing CRM username format." />
          <Input label="Initial password" type="text" placeholder="Leave empty to generate automatically" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
          {error && <div className="alert-panel alert-panel--danger" role="alert"><AlertCircle size={16} className="mt-0.5 shrink-0" /><span>{error}</span></div>}
        </div>

        <fieldset>
          <legend className="field-label flex items-center gap-2"><ShieldCheck size={14} /> Capabilities</legend>
          <p className="mb-3 text-[11px] leading-5 text-[var(--text-muted)]">Select all areas this account must access. Additional access can be granted later from the capability matrix.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {Object.entries(CAPABILITY_LABELS).map(([code, label]) => {
              const checked = form.capabilities.includes(code);
              return (
                <label key={code} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-[var(--radius-md)] border px-3 text-[12px] font-semibold transition ${checked ? "border-[var(--brand-200)] bg-[var(--brand-50)] text-[var(--brand-700)]" : "border-[var(--border-subtle)] bg-[var(--surface-secondary)] text-[var(--text-secondary)] hover:border-[var(--border-default)]"}`}>
                  <input type="checkbox" checked={checked} onChange={(event) => setForm({ ...form, capabilities: event.target.checked ? [...form.capabilities, code] : form.capabilities.filter((capability) => capability !== code) })} className="h-4 w-4 rounded accent-[var(--brand-600)]" />
                  <span>{label}</span>
                </label>
              );
            })}
          </div>
          <div className="mt-6 flex justify-end border-t border-[var(--border-subtle)] pt-5"><Button type="submit" disabled={!form.capabilities.length || !form.name.trim() || !form.email.trim()} isLoading={isLoading} icon={<UserPlus size={15} />}>Create account</Button></div>
        </fieldset>
      </form>
    </section>
  );
}
