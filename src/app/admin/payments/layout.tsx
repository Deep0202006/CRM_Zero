"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [{ href: "/admin/payments", label: "Collections" }, { href: "/admin/payments/renewals", label: "Renewals" }, { href: "/admin/payments/distributors", label: "Distributor Status" }];

export default function AdminPaymentsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return <div className="flex flex-col gap-6"><nav aria-label="Payment Collection" className="flex gap-6 border-b border-[var(--border-subtle)] px-6 pt-6">{tabs.map(tab => <Link key={tab.href} href={tab.href} className={`pb-2 text-sm font-semibold transition-colors ${pathname === tab.href || (tab.href !== "/admin/payments" && pathname.startsWith(tab.href)) ? "border-b-2 border-brand-500 text-brand-700" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"}`}>{tab.label}</Link>)}</nav>{children}</div>;
}
