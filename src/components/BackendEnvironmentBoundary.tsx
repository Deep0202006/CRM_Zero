"use client";

import dynamic from "next/dynamic";
import { backendEnvironment } from "@/lib/supabaseClient";

const AuthorizedCrmShell = dynamic(() => import("./AuthorizedCrmShell"));

export default function BackendEnvironmentBoundary({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  if (backendEnvironment.status !== "configured") {
    const preview = backendEnvironment.deployment === "preview";
    return (
      <main className="grid min-h-svh place-items-center bg-canvas px-4 py-8">
        <section
          role="status"
          aria-live="polite"
          data-backend-mode="unavailable"
          className="w-full max-w-lg rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--surface-primary)] p-6 text-center shadow-[var(--shadow-card)] sm:p-10"
        >
          <h1 className="text-balance text-2xl font-bold text-[var(--text-primary)] sm:text-3xl">
            {preview ? "Preview workspace" : "CRM unavailable"}
          </h1>
          <p className="mt-4 text-pretty text-sm leading-6 text-[var(--text-secondary)] sm:text-base">
            {preview
              ? "This preview is intentionally disconnected from live CRM data. Sign-in and data actions are unavailable."
              : "This environment cannot securely connect to CRM data. Please contact your administrator."}
          </p>
        </section>
      </main>
    );
  }

  return <AuthorizedCrmShell>{children}</AuthorizedCrmShell>;
}
