"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
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
  Link2,
  PhoneCall,
  Search,
  Bell,
  Menu,
  ChevronLeft,
  ChevronRight,
  User,
} from "lucide-react";
import { db } from "@/lib/db";

const LOGO_CLASSES = "h-8 w-8 object-contain shrink-0";

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
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsOnline(navigator.onLine);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    const interval = setInterval(async () => {
      try {
        const all = await db.sync_queue.toArray();
        setSyncQueueCount(all.filter((i) => (i.retry_count ?? 0) < 5).length);
        setFailedSyncCount(all.filter((i) => (i.retry_count ?? 0) >= 5).length);
      } catch {
        /* ignore */
      }
    }, 1500);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      clearInterval(interval);
    };
  }, []);

  if (pathname === "/login") return <>{children}</>;

  const getRoleLabel = () => {
    if (isAdmin) return "System Admin";
    if (capabilities.length > 0) {
      return capabilities
        .map((c) =>
          c
            .replace("dist_", "Dist. ")
            .replace("ret_", "Retailer ")
            .replace("field_", "Field ")
            .replace("tech_", "Tech ")
            .replace(/_/g, " ")
        )
        .join(", ");
    }
    return "User Account";
  };

  const getInitials = () => {
    if (!currentUser?.name) return "US";
    const parts = currentUser.name.split(" ");
    return parts.length > 1
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : parts[0].substring(0, 2).toUpperCase();
  };

  const navItems = [
    { icon: ListTodo, label: "My Day", path: "/my-day" },
    { icon: PhoneCall, label: "Log Call", path: "/call-logs" },
    { icon: LayoutDashboard, label: "Pipeline", path: "/onboarding", visible: hasOnboarding },
    { icon: Headphones, label: "Client Support", path: "/support", visible: hasSupport },
    { icon: Link2, label: "Mappings", path: "/mappings", visible: hasSupport },
    { icon: Clock, label: "Attendance", path: "/attendance", visible: isFieldStaff || isOfficeStaff },
    { icon: ShieldCheck, label: "Admin Control", path: "/admin", visible: isAdmin },
    { icon: UserPlus, label: "Assign Task", path: "/manager/tasks", visible: isTaskAssigner },
    { icon: TrendingUp, label: "Team KPIs", path: "/manager/kpi", visible: isAdmin },
    { icon: CalendarDays, label: "Team Attendance", path: "/admin/attendance", visible: isAdmin },
    { icon: BarChart3, label: "Insights", path: "/", visible: isAdmin },
  ];

  const visibleItems = navItems.filter((item) => item.visible !== false);

  const getBreadcrumbs = () => {
    if (pathname === "/") return "Insights";
    const current = visibleItems.find((i) => i.path !== "/" && pathname.startsWith(i.path));
    return current ? current.label : "CRM Zero";
  };

  return (
    <div className="flex h-dvh w-full bg-[var(--surface-canvas)] text-[var(--text-primary)] antialiased font-normal overflow-hidden">
      {/* ── Desktop Sidebar ── */}
      <aside
        className={`hidden md:flex flex-col bg-[var(--surface-sidebar)] text-[var(--text-inverse)] transition-all duration-200 ease-in-out shrink-0 border-r border-slate-800 z-[var(--z-sidebar)] ${
          collapsed ? "w-[72px]" : "w-[248px]"
        }`}
      >
        {/* Sidebar Header */}
        <div className="h-[56px] px-4 flex items-center justify-between border-b border-slate-800/80">
          <div className="flex items-center gap-3 overflow-hidden">
            <img src="/logo-icon.png" alt="ZeroData" className={LOGO_CLASSES} />
            {!collapsed && (
              <div className="flex flex-col leading-tight whitespace-nowrap">
                <span className="font-black text-sm tracking-tight text-white">ZeroData</span>
                <span className="text-[9px] uppercase font-bold tracking-widest text-slate-400">
                  CRM Zero
                </span>
              </div>
            )}
          </div>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>

        {/* Navigation Items */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1 scrollbar-hide">
          {visibleItems.map((item) => {
            const active =
              pathname === item.path || (item.path !== "/" && pathname.startsWith(item.path));
            return (
              <Link
                key={item.label}
                href={item.path}
                className={`flex items-center h-[36px] px-3 rounded-[var(--radius-md)] text-xs font-semibold transition-all duration-150 group ${
                  active
                    ? "bg-[var(--brand-500)] text-white shadow-sm"
                    : "text-slate-400 hover:text-white hover:bg-[var(--surface-sidebar-hover)]"
                }`}
                title={collapsed ? item.label : undefined}
              >
                <item.icon
                  size={18}
                  className={`shrink-0 ${active ? "text-white" : "group-hover:text-white"}`}
                />
                {!collapsed && <span className="ml-3 truncate">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        {/* User Footer */}
        <div className="p-3 border-t border-slate-800/80 bg-slate-950/40">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-[var(--brand-500)] flex items-center justify-center text-white text-xs font-black shrink-0">
              {getInitials()}
            </div>
            {!collapsed && (
              <div className="flex-1 min-w-0 leading-tight">
                <p className="text-xs font-black text-white truncate">
                  {currentUser?.name || "Loading..."}
                </p>
                <p className="text-[10px] text-slate-400 truncate">{getRoleLabel()}</p>
              </div>
            )}
            {!collapsed && (
              <button
                onClick={logout}
                className="p-1.5 rounded-md text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
                title="Sign Out"
              >
                <LogOut size={16} />
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* ── Main Layout Wrapper ── */}
      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* ── Top Utility Bar (56px) ── */}
        <header className="h-[56px] bg-[var(--surface-primary)] border-b border-[var(--border-subtle)] px-4 flex items-center justify-between shrink-0 z-[var(--z-topbar)] shadow-xs">
          {/* Left Controls */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="md:hidden p-1.5 rounded-md text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] cursor-pointer"
            >
              <Menu size={20} />
            </button>
            <div className="flex items-center gap-2 text-xs font-bold text-[var(--text-secondary)]">
              <span className="text-[var(--text-muted)]">Workspace</span>
              <span>/</span>
              <span className="text-[var(--text-primary)] font-black">{getBreadcrumbs()}</span>
            </div>
          </div>

          {/* Right Controls */}
          <div className="flex items-center gap-3">
            {/* Search Bar / Quick Command */}
            <div className="hidden sm:flex items-center gap-2 bg-[var(--surface-secondary)] border border-[var(--border-subtle)] px-3 py-1.5 rounded-[var(--radius-md)] text-xs text-[var(--text-muted)] w-48 lg:w-64 cursor-pointer hover:border-[var(--border-default)] transition-all">
              <Search size={14} />
              <span className="flex-1 truncate">Search or press Cmd+K</span>
              <kbd className="hidden lg:inline-block px-1.5 py-0.5 text-[9px] font-mono bg-[var(--surface-primary)] border border-[var(--border-default)] rounded text-[var(--text-muted)]">
                ⌘K
              </kbd>
            </div>

            {/* Network / Sync Status */}
            <div className="flex items-center gap-2 px-2 py-1 bg-[var(--surface-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-round)] text-[10px] font-bold">
              {isOnline ? (
                <span className="flex items-center gap-1 text-[var(--status-success)]">
                  <Wifi size={12} /> <span className="hidden sm:inline">Online</span>
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[var(--status-danger)] animate-pulse">
                  <WifiOff size={12} /> <span>Offline</span>
                </span>
              )}
              {syncQueueCount > 0 && (
                <span className="bg-[var(--brand-50)] text-[var(--brand-500)] px-1.5 py-0.2 rounded-full text-[9px] font-black">
                  {syncQueueCount}
                </span>
              )}
              {failedSyncCount > 0 && (
                <span className="bg-[var(--status-warning-soft)] text-[var(--status-warning)] px-1.5 py-0.2 rounded-full text-[9px] font-black flex items-center gap-0.5">
                  <AlertTriangle size={8} /> {failedSyncCount}
                </span>
              )}
            </div>

            {/* Profile Avatar / Quick Actions */}
            <div className="h-8 w-8 rounded-full bg-[var(--brand-50)] border border-[var(--brand-500)]/30 flex items-center justify-center text-[var(--brand-500)] font-black text-xs">
              {getInitials()}
            </div>
          </div>
        </header>

        {/* ── Main Workspace Area ── */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-[var(--surface-canvas)]">
          <div className="max-w-7xl mx-auto space-y-6">{children}</div>
        </main>
      </div>

      {/* ── Mobile Sidebar Drawer ── */}
      {mobileOpen && (
        <div className="fixed inset-0 z-[var(--z-drawer)] md:hidden">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-xs"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="fixed left-0 top-0 bottom-0 w-[240px] bg-[var(--surface-sidebar)] text-white p-4 flex flex-col justify-between shadow-2xl z-[var(--z-drawer)]">
            <div className="space-y-6">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div className="flex items-center gap-2">
                  <img src="/logo-icon.png" alt="ZeroData" className={LOGO_CLASSES} />
                  <span className="font-black text-sm text-white">ZeroData</span>
                </div>
                <button
                  onClick={() => setMobileOpen(false)}
                  className="text-slate-400 hover:text-white"
                >
                  ✕
                </button>
              </div>

              <nav className="space-y-1">
                {visibleItems.map((item) => {
                  const active =
                    pathname === item.path || (item.path !== "/" && pathname.startsWith(item.path));
                  return (
                    <Link
                      key={item.label}
                      href={item.path}
                      onClick={() => setMobileOpen(false)}
                      className={`flex items-center h-[38px] px-3 rounded-[var(--radius-md)] text-xs font-semibold ${
                        active
                          ? "bg-[var(--brand-500)] text-white"
                          : "text-slate-400 hover:text-white hover:bg-slate-800"
                      }`}
                    >
                      <item.icon size={18} className="mr-3" />
                      <span>{item.label}</span>
                    </Link>
                  );
                })}
              </nav>
            </div>

            <div className="pt-4 border-t border-slate-800">
              <button
                onClick={() => {
                  setMobileOpen(false);
                  logout();
                }}
                className="w-full flex items-center justify-center gap-2 py-2 text-xs font-bold text-slate-400 hover:text-rose-400 bg-slate-900 rounded-[var(--radius-md)]"
              >
                <LogOut size={16} />
                <span>Sign Out</span>
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
