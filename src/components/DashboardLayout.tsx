"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import {
  LayoutDashboard,
  Clock,
  BarChart3,
  ShieldCheck,
  Headphones,
  LogOut,
  Wifi,
  WifiOff,
  ListTodo,
  UserPlus,
  TrendingUp,
  AlertTriangle,
  CalendarDays,
  LineChart,
  Link2,
} from 'lucide-react';
import { db } from '@/lib/db';

const LOGO_CLASSES = "h-9 w-9 object-contain flex-shrink-0";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const pathname = usePathname();
  const {
    currentUser,
    capabilities,
    isAdmin,
    isFieldStaff,
    isOfficeStaff,
    hasOnboarding,
    hasSupport,
    isTaskAssigner,
    logout,
  } = useAuth();

  const [isOnline, setIsOnline] = useState(true);
  const [syncQueueCount, setSyncQueueCount] = useState(0);
  const [failedSyncCount, setFailedSyncCount] = useState(0);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsOnline(navigator.onLine);
    const handleOnline  = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online",  handleOnline);
    window.addEventListener("offline", handleOffline);

    const interval = setInterval(async () => {
      try {
        const all = await db.sync_queue.toArray();
        setSyncQueueCount(all.filter(i => (i.retry_count ?? 0) < 5).length);
        setFailedSyncCount(all.filter(i => (i.retry_count ?? 0) >= 5).length);
      } catch { /* ignore */ }
    }, 1500);

    return () => {
      window.removeEventListener("online",  handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(interval);
    };
  }, []);

  if (pathname === '/login') return <>{children}</>;

  // ─── Role label ──────────────────────────────────────────────────────────
  const getRoleLabel = () => {
    if (isAdmin) return "System Admin";
    if (capabilities.length > 0) {
      return capabilities
        .map(c => c.replace("dist_", "Dist. ").replace("ret_", "Retailer ").replace("field_", "Field ").replace("tech_", "Tech ").replace(/_/g, " "))
        .join(", ");
    }
    return "User Account";
  };

  const getInitials = () => {
    if (!currentUser?.name) return "US";
    const parts = currentUser.name.split(" ");
    return parts.length > 1 ? (parts[0][0] + parts[1][0]).toUpperCase() : parts[0].substring(0, 2).toUpperCase();
  };

  // ─── Navigation — strictly capability-gated ───────────────────────────
  // visible: undefined = always show; true/false = conditional
  const navItems = [
    // Everyone
    { icon: ListTodo,       label: "My Day",           path: "/my-day" },
    // Onboarding only
    { icon: LayoutDashboard,label: "Pipeline",         path: "/onboarding",        visible: hasOnboarding },
    // Support only
    { icon: Headphones,     label: "Client Support",   path: "/support",           visible: hasSupport },
    { icon: Link2,          label: "Mappings",         path: "/mappings",          visible: hasSupport },
    // Not admin (admin doesn't clock in)
    { icon: Clock,          label: "Attendance",       path: "/attendance",        visible: isFieldStaff || isOfficeStaff },
    // Admin tools
    { icon: ShieldCheck,    label: "Admin Control",    path: "/admin",             visible: isAdmin },
    { icon: UserPlus,       label: "Assign Task",      path: "/manager/tasks",     visible: isTaskAssigner },
    { icon: TrendingUp,     label: "Team KPIs",        path: "/manager/kpi",       visible: isAdmin },
    { icon: CalendarDays,   label: "Team Attendance",  path: "/admin/attendance",  visible: isAdmin },
    { icon: BarChart3,      label: "Insights",         path: "/",                  visible: isAdmin },
  ];

  const visibleItems = navItems.filter(item => item.visible !== false);

  // ─── Sync status badge ────────────────────────────────────────────────
  const SyncBadges = () => (
    <>
      {syncQueueCount > 0 && (
        <span className="bg-brand-primary/10 text-brand-primary text-[9px] font-bold px-1.5 py-0.5 rounded-full animate-pulse">
          {syncQueueCount}
        </span>
      )}
      {failedSyncCount > 0 && (
        <span title={`${failedSyncCount} failed after 5 retries`} className="bg-amber-100 text-amber-700 text-[9px] font-bold px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
          <AlertTriangle size={8} />{failedSyncCount}
        </span>
      )}
    </>
  );

  return (
    <div className="flex min-h-screen bg-canvas text-slate-600 antialiased font-normal">

      {/* ── Desktop Glass Sidebar ── */}
      <aside className="hidden md:flex fixed left-6 top-6 bottom-6 w-64 flex-col rounded-3xl bg-white/75 backdrop-blur-xl border border-white/40 shadow-[0_8px_32px_0_rgba(31,38,135,0.04)] z-50 p-6">
        {/* Logo + sync */}
        <div className="mb-8 px-2 flex items-center justify-between">
          <div className="flex items-center gap-3 py-1">
            <img src="/logo-icon.png" alt="ZeroData" className={LOGO_CLASSES} />
            <div className="flex flex-col leading-tight">
              <span className="font-bold text-lg tracking-tight text-gray-900">
                ZeroData
              </span>
              <span className="text-[10px] uppercase tracking-wider text-gray-400">
                Your data is yours
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {isOnline
              ? <span title="Online"><Wifi size={14} className="text-status-success" /></span>
              : <span title="Offline"><WifiOff size={14} className="text-status-error animate-pulse" /></span>}
            <SyncBadges />
          </div>
        </div>

        {/* Nav */}
        <nav className="space-y-1 flex-1 overflow-y-auto pr-1">
          {visibleItems.map(item => {
            const active = pathname === item.path || (item.path !== "/" && pathname.startsWith(item.path));
            return (
              <Link
                key={item.label}
                href={item.path}
                className={`w-full flex items-center space-x-3 px-4 py-3 rounded-xl transition-all duration-200 ${
                  active
                    ? "bg-brand-primary text-white shadow-lg shadow-brand-primary/20"
                    : "text-slate-600 hover:bg-white/50 hover:text-brand-primary"
                }`}
              >
                <item.icon size={18} />
                <span className="font-bold text-xs tracking-tight">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* User footer */}
        <div className="border-t border-slate-100 pt-4 mt-4">
          <div className="flex items-center space-x-3 mb-4">
            <div className="h-9 w-9 rounded-full bg-brand-secondary border-2 border-white shadow-sm flex items-center justify-center text-white text-xs font-black">
              {getInitials()}
            </div>
            <div className="flex-1 min-w-0 leading-tight">
              <p className="text-xs font-black text-slate-900 truncate">{currentUser?.name || "Loading..."}</p>
              <p className="text-[10px] text-slate-400 truncate">{getRoleLabel()}</p>
            </div>
          </div>
          <button
            onClick={logout}
            className="w-full flex items-center justify-center space-x-2 py-2.5 bg-slate-50 hover:bg-rose-50 text-slate-500 hover:text-status-error border border-slate-200/60 rounded-xl transition-all duration-200 cursor-pointer text-xs font-bold"
          >
            <LogOut size={14} /><span>Sign Out</span>
          </button>
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main className="md:ml-[280px] flex-1 min-w-0 w-full p-6 md:p-8 pb-24 md:pb-8 max-w-full overflow-x-hidden">
        {/* Mobile header */}
        <header className="flex justify-between items-center mb-8 md:hidden">
          <div className="flex items-center space-x-3">
            <img src="/logo-icon.png" alt="ZeroData" className={LOGO_CLASSES} />
            <div className="flex flex-col leading-tight">
              <span className="font-bold text-lg tracking-tight text-gray-900">
                ZeroData
              </span>
              <span className="text-[10px] uppercase tracking-wider text-gray-400 hidden sm:block">
                Your data is yours
              </span>
            </div>
            <div className="flex items-center gap-1 ml-1">
              {!isOnline && <WifiOff size={12} className="text-status-error animate-pulse" />}
              <SyncBadges />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-brand-secondary border-2 border-white shadow-sm flex items-center justify-center text-white font-black text-xs">
              {getInitials()}
            </div>
          </div>
        </header>

        {children}
      </main>

      {/* ── Mobile Bottom Bar ── */}
      <nav className="md:hidden fixed bottom-4 left-4 right-4 h-16 bg-white/80 backdrop-blur-xl border border-white/40 shadow-2xl rounded-2xl flex justify-around items-center z-50 px-2">
        {visibleItems.slice(0, 5).map(item => {
          const active = pathname === item.path || (item.path !== "/" && pathname.startsWith(item.path));
          return (
            <Link
              key={item.label}
              href={item.path}
              className={`p-2.5 rounded-xl transition-all ${active ? "text-brand-primary bg-brand-primary/5" : "text-slate-400 hover:text-slate-600"}`}
              title={item.label}
            >
              <item.icon size={22} />
            </Link>
          );
        })}
        <button
          onClick={logout}
          className="p-2.5 rounded-xl text-slate-400 hover:text-status-error"
          title="Sign Out"
        >
          <LogOut size={22} />
        </button>
      </nav>
    </div>
  );
}
