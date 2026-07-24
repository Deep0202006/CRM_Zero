"use client";

import Image from "next/image";

interface AppLogoProps {
  collapsed?: boolean;
  inverse?: boolean;
  className?: string;
}

export function AppLogo({ collapsed = false, inverse = false, className = "" }: AppLogoProps) {
  return (
    <div className={`flex min-w-0 items-center gap-3 ${className}`} aria-label="ZeroData CRM">
      <span
        className={`grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-[11px] border ${
          inverse
            ? "border-white/10 bg-white text-[var(--surface-sidebar)]"
            : "border-[var(--border-default)] bg-[var(--surface-primary)] text-[var(--text-primary)]"
        }`}
      >
        <Image src="/logo-icon.png" alt="" width={30} height={30} className="h-8 w-8 object-cover" priority />
      </span>
      {!collapsed && (
        <span className="min-w-0 leading-none">
          <span
            className={`block truncate text-[15px] font-bold tracking-[0.16em] ${
              inverse ? "text-white" : "text-[var(--text-primary)]"
            }`}
          >
            ZERODATA
          </span>
          <span
            className={`mt-1 block truncate text-[9px] font-semibold uppercase tracking-[0.18em] ${
              inverse ? "text-[var(--text-inverse-muted)]" : "text-[var(--text-muted)]"
            }`}
          >
            Operations CRM
          </span>
        </span>
      )}
    </div>
  );
}
