"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { EmptyState } from "@/components/ui/EmptyState";
import { ShieldCheck } from "lucide-react";

type Erp = { erp_id: string; erp_name: string };
type Partner = {
  user_id: string;
  name: string;
  email: string;
  is_active: boolean;
  erp_scope_ids: string[];
};

export function ErpPartnerAccessPanel() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [erps, setErps] = useState<Erp[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [message, setMessage] = useState("");

  const request = useCallback(async (init?: RequestInit) => {
    const { data } = await supabase.auth.getSession();
    const response = await fetch("/api/admin/erp-partners", {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${data.session?.access_token}`,
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(result.error ?? "ERP Partner Access unavailable");
    return result;
  }, []);

  const load = useCallback(async () => {
    const result = await request();
    setPartners(result.users ?? []);
    setErps(result.erps ?? []);
    setDrafts(
      Object.fromEntries(
        (result.users ?? []).map((user: Partner) => [
          user.user_id,
          user.erp_scope_ids,
        ]),
      ),
    );
  }, [request]);

  useEffect(() => {
    void load().catch((error) => setMessage(error.message));
  }, [load]);

  async function save(userId: string) {
    const scopes = drafts[userId] ?? [];
    if (!scopes.length)
      return setMessage("At least one ERP scope is required.");
    try {
      await request({
        method: "POST",
        body: JSON.stringify({ user_id: userId, erp_scope_ids: scopes }),
      });
      setMessage("ERP scopes updated.");
      await load();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Scope update failed",
      );
    }
  }

  if (!partners.length)
    return (
      <EmptyState
        icon={<ShieldCheck size={21} />}
        title="No ERP Partner accounts"
        description="Create an ERP Partner Viewer account before assigning scopes."
      />
    );
  return (
    <section className="space-y-3">
      {message && <div className="alert-panel">{message}</div>}
      {partners.map((partner) => (
        <article key={partner.user_id} className="surface-panel p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold">{partner.name}</p>
              <p className="text-xs text-[var(--text-muted)]">
                {partner.email}
              </p>
            </div>
            <Chip variant={partner.is_active ? "success" : "neutral"}>
              {partner.is_active ? "Active" : "Inactive"}
            </Chip>
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {erps.map((erp) => {
              const checked = (drafts[partner.user_id] ?? []).includes(
                erp.erp_id,
              );
              return (
                <label
                  key={erp.erp_id}
                  className="flex items-center gap-2 rounded border p-3 text-xs font-semibold"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(event) =>
                      setDrafts({
                        ...drafts,
                        [partner.user_id]: event.target.checked
                          ? [...(drafts[partner.user_id] ?? []), erp.erp_id]
                          : (drafts[partner.user_id] ?? []).filter(
                              (id) => id !== erp.erp_id,
                            ),
                      })
                    }
                  />
                  {erp.erp_name}
                </label>
              );
            })}
          </div>
          <div className="mt-4 flex justify-end">
            <Button size="sm" onClick={() => void save(partner.user_id)}>
              Save scopes
            </Button>
          </div>
        </article>
      ))}
    </section>
  );
}
