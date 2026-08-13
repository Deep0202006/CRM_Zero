"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function PaymentsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex flex-col gap-6">
      <nav className="flex gap-6 border-b border-[var(--border-subtle)] pb-2 px-6 pt-6">
        <Link
          href="/payments"
          className={`pb-2 text-sm font-semibold transition-colors ${
            pathname === "/payments"
              ? "border-b-2 border-brand-500 text-brand-700"
              : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          }`}
        >
          Collection
        </Link>
        <Link
          href="/payments/renewals"
          className={`pb-2 text-sm font-semibold transition-colors ${
            pathname?.startsWith("/payments/renewals")
              ? "border-b-2 border-brand-500 text-brand-700"
              : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          }`}
        >
          Renewal
        </Link>
      </nav>
      {children}
    </div>
  );
}
