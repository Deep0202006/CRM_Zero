"use client";

import React from "react";
import { useAuth } from "@/context/AuthContext";
import { AlertCircle } from "lucide-react";
import { ActivityDeck } from "@/components/admin/ActivityDeck";

export default function AdminActivityPage() {
  const { isAdmin } = useAuth();

  if (!isAdmin) {
    return (
      <section className="access-state" aria-labelledby="admin-access-title">
        <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-[var(--radius-lg)] bg-[var(--status-danger-soft)] text-[var(--status-danger)]">
          <AlertCircle size={22} />
        </span>
        <h1 id="admin-access-title" className="text-lg font-semibold">Administrator access required</h1>
        <p className="mx-auto mt-2 max-w-sm text-[13px] leading-5 text-[var(--text-muted)]">
          Day-wise operational activity monitoring is restricted to administrators.
        </p>
      </section>
    );
  }

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
      <ActivityDeck />
    </div>
  );
}
