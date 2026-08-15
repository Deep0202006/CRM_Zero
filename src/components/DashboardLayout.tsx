"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import {
  BarChart3,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Headphones,
  LayoutDashboard,
  Link2,
  ListTodo,
  LogOut,
  MapPin,
  Menu,
  MessageCircle,
  Moon,
  PhoneCall,
  Search,
  ShieldCheck,
  Sun,
  TrendingUp,
  UserPlus,
  Wifi,
  WifiOff,
  X,
  Activity,
  WalletCards,
} from "lucide-react";
import { db, processSyncQueue } from "@/lib/db";
import { syncFieldVisits } from "@/lib/fieldVisits/sync";
import { AppLogo } from "@/components/AppLogo";
import { CommandItem, CommandPalette } from "@/components/CommandPalette";
import { VerifiedLogoutModal } from "@/components/VerifiedLogoutModal";
import { FormEnterNavigator } from "@/components/FormEnterNavigator";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

type NavItem = CommandItem & {
  visible?: boolean;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const pathname = usePathname();
  const {
    currentUser,
    capabilities,
    isLoading,
    isAdmin,
    isFieldStaff,
    isOfficeStaff,
    hasField,
    hasOnboarding,
    hasSupport,
    isTaskAssigner,
  } = useAuth();

  const [isOnline, setIsOnline] = useState(true);
  const [syncQueueCount, setSyncQueueCount] = useState(0);
  const [failedSyncCount, setFailedSyncCount] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [logoutOpen, setLogoutOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const syncRef = useRef<HTMLDivElement>(null);
  const mobileDrawerRef = useRef<HTMLElement>(null);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const storedCollapsed = localStorage.getItem("zerodata-sidebar-collapsed") === "true";
    setCollapsed(storedCollapsed);
    const currentTheme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    setTheme(currentTheme);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || pathname === "/login") return;
    setIsOnline(navigator.onLine);
    const drainWork = () => { void Promise.allSettled([processSyncQueue(), syncFieldVisits()]); };
    const handleOnline = () => { setIsOnline(true); drainWork(); };
    const handleOffline = () => setIsOnline(false);
    const handleVisibility = () => { if (document.visibilityState === "visible" && navigator.onLine) drainWork(); };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisibility);
    if (navigator.onLine) drainWork();

    const refreshSyncState = async () => {
      try {
        const all = await db.sync_queue.toArray();
        setSyncQueueCount(all.filter((item) => (item.retry_count ?? 0) < 5).length);
        setFailedSyncCount(all.filter((item) => (item.retry_count ?? 0) >= 5).length);
      } catch {
        setSyncQueueCount(0);
        setFailedSyncCount(0);
      }
    };

    refreshSyncState();
    const interval = window.setInterval(refreshSyncState, 8000);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.clearInterval(interval);
    };
  }, [pathname]);

  const [prevPathname, setPrevPathname] = useState(pathname);
  if (prevPathname !== pathname) {
    setPrevPathname(pathname);
    if (mobileOpen) setMobileOpen(false);
    if (profileOpen) setProfileOpen(false);
    if (syncOpen) setSyncOpen(false);
  }

  useEffect(() => {
    if (!mobileOpen) return;

    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableSelector = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(",");

    const focusFirstControl = window.requestAnimationFrame(() => {
      mobileDrawerRef.current?.querySelector<HTMLElement>(focusableSelector)?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMobileOpen(false);
        return;
      }

      if (event.key !== "Tab" || !mobileDrawerRef.current) return;
      const focusable = Array.from(
        mobileDrawerRef.current.querySelectorAll<HTMLElement>(focusableSelector)
      ).filter((element) => element.offsetParent !== null);

      if (!focusable.length) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    const menuButton = mobileMenuButtonRef.current;

    return () => {
      window.cancelAnimationFrame(focusFirstControl);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
      else menuButton?.focus();
    };
  }, [mobileOpen]);

  useEffect(() => {
    function handleOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (profileRef.current && !profileRef.current.contains(target)) setProfileOpen(false);
      if (syncRef.current && !syncRef.current.contains(target)) setSyncOpen(false);
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const roleLabel = useMemo(() => {
    if (isAdmin) return "System administrator";
    if (!capabilities.length) return "ZeroData team member";
    return capabilities
      .slice(0, 2)
      .map((capability) =>
        capability
          .replace("dist_", "Distributor ")
          .replace("ret_", "Retailer ")
          .replace("field_", "Field ")
          .replace("tech_", "Technical ")
          .replace(/_/g, " ")
      )
      .join(" · ");
  }, [capabilities, isAdmin]);

  const initials = useMemo(() => {
    const name = currentUser?.name?.trim();
    if (!name) return "ZD";
    const parts = name.split(/\s+/);
    return parts.length > 1
      ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
      : parts[0].slice(0, 2).toUpperCase();
  }, [currentUser?.name]);

  if (pathname === "/login") return <>{children}</>;

  const navGroups: NavGroup[] = [
    {
      label: "Workspace",
      items: [
        {
          icon: <ListTodo size={17} />,
          label: "My Day",
          path: "/my-day",
          description: "Tasks, targets, and daily execution",
          group: "Workspace",
          keywords: ["tasks", "today", "targets"],
        },
        {
          icon: <PhoneCall size={17} />,
          label: "Call Logs",
          path: "/call-logs",
          description: "Record call outcomes and follow-ups",
          group: "Workspace",
          keywords: ["phone", "followup", "calls"],
        },
        {
          icon: <WalletCards size={17} />,
          label: isAdmin ? "Payment Collections" : "Payment Follow-ups",
          path: isAdmin ? "/admin/payments" : "/payments",
          description: "Receivables and collection actions",
          group: "Workspace",
          keywords: ["payments", "collections", "receivables"],
        },
        {
          icon: <CalendarDays size={17} />,
          label: "Renewals",
          path: isAdmin ? "/admin/payments/renewals" : "/payments/renewals",
          description: "Assigned distributor renewal dates",
          group: "Workspace",
          keywords: ["payment", "renewal", "due", "overdue"],
        },
        {
          icon: <CalendarDays size={17} />,
          label: "Distributor Status",
          path: isAdmin ? "/admin/payments/distributors" : "/payments/distributors",
          description: "Operational status and renewals",
          group: "Workspace",
          keywords: ["distributor", "renewal", "installation", "training"],
        },
        {
          icon: <MessageCircle size={17} />,
          label: "Team Chat",
          path: "/chat",
          description: "Team room and direct employee messages",
          group: "Workspace",
          keywords: ["chat", "messages", "team", "direct"],
        },
        {
          icon: <MapPin size={17} />,
          label: "Field Visits",
          path: "/visits",
          description: "Log shop visits and view history",
          group: "Workspace",
          visible: hasField,
          keywords: ["visit", "location", "field", "shop"],
        },
        {
          icon: <LayoutDashboard size={17} />,
          label: "Pipeline",
          path: "/onboarding",
          description: "Move retailer and distributor leads",
          group: "Workspace",
          visible: hasOnboarding,
          keywords: ["lead", "kanban", "onboarding"],
        },
        {
          icon: <Headphones size={17} />,
          label: "Client Support",
          path: "/support",
          description: "Resolve client issues and service requests",
          group: "Workspace",
          visible: hasSupport,
          keywords: ["tickets", "queries", "issues"],
        },
        {
          icon: <Link2 size={17} />,
          label: "Mappings",
          path: "/mappings",
          description: "Link distributors and retailers",
          group: "Workspace",
          visible: hasSupport,
          keywords: ["mapping", "linkage"],
        },
      ],
    },
    {
      label: "People",
      items: [
        {
          icon: <Clock size={17} />,
          label: "Attendance",
          path: "/attendance",
          description: "Clock in and verify attendance",
          group: "People",
          visible: isFieldStaff || isOfficeStaff,
        },
        {
          icon: <CalendarDays size={17} />,
          label: "Team Attendance",
          path: "/admin/attendance",
          description: "Review attendance across the team",
          group: "People",
          visible: isAdmin,
        },
        {
          icon: <TrendingUp size={17} />,
          label: "Team KPIs",
          path: "/manager/kpi",
          description: "Performance and conversion reporting",
          group: "People",
          visible: isAdmin,
        },
      ],
    },
    {
      label: "Management",
      items: [
        {
          icon: <UserPlus size={17} />,
          label: "Assign Tasks",
          path: "/manager/tasks",
          description: "Allocate tasks and field targets",
          group: "Management",
          visible: isTaskAssigner,
        },
        {
          icon: <MapPin size={17} />,
          label: "Visits Overview",
          path: "/admin/visits",
          description: "Monitor field visit compliance",
          group: "Management",
          visible: isAdmin,
        },
        {
          icon: <ShieldCheck size={17} />,
          label: "Admin Control",
          path: "/admin",
          description: "Users, roles, and capability access",
          group: "Management",
          visible: isAdmin,
        },
        {
          icon: <BarChart3 size={17} />,
          label: "Insights",
          path: "/",
          description: "Operational pulse and recent activity",
          group: "Management",
          visible: isAdmin,
        },
      ],
    },
  ];

  const visibleGroups = navGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => item.visible !== false) }))
    .filter((group) => group.items.length > 0);

  const commandItems = visibleGroups.flatMap((group) => group.items);
  const activeItem = commandItems.find((item) =>
    item.path === "/" ? pathname === "/" : pathname.startsWith(item.path)
  );

  const toggleTheme = () => {
    const nextTheme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem("zerodata-theme", nextTheme);
  };

  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem("zerodata-sidebar-collapsed", String(next));
  };

  const navCollapsed = collapsed && !mobileOpen;

  const navContent = (
    <>
      <div className={`flex h-[76px] items-center border-b border-[var(--border-inverse)] px-4 ${navCollapsed ? "justify-center" : "justify-between"}`}>
        <AppLogo collapsed={navCollapsed} inverse />
        {!navCollapsed && (
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="grid h-9 w-9 place-items-center rounded-[var(--radius-md)] text-[var(--text-inverse-muted)] hover:bg-white/5 hover:text-white md:hidden"
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        )}
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-4" aria-label="Primary navigation">
        <div className="space-y-5">
          {visibleGroups.map((group) => (
            <div key={group.label}>
              {!navCollapsed && (
                <p className="mb-2 px-2 text-[9px] font-bold uppercase tracking-[0.16em] text-[var(--text-inverse-muted)]/70">
                  {group.label}
                </p>
              )}
              <div className="space-y-1">
                {group.items.map((item) => {
                  const active = item.path === "/" ? pathname === "/" : pathname.startsWith(item.path);
                  return (
                    <Link
                      key={item.path}
                      href={item.path}
                      title={navCollapsed ? item.label : undefined}
                      aria-current={active ? "page" : undefined}
                      className={`group relative flex h-10 items-center rounded-[var(--radius-md)] text-[12px] font-medium transition-[background-color,color,transform] ${
                        navCollapsed ? "justify-center px-0" : "gap-3 px-3"
                      } ${
                        active
                          ? "bg-[var(--surface-sidebar-active)] text-white shadow-[inset_0_0_0_1px_var(--surface-inverse-outline)]"
                          : "text-[var(--text-inverse-muted)] hover:bg-[var(--surface-sidebar-hover)] hover:text-white"
                      }`}
                    >
                      {active && !navCollapsed && <span className="absolute left-0 h-5 w-[2px] rounded-r-full bg-[var(--brand-400)]" aria-hidden="true" />}
                      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-[8px] ${active ? "bg-white/8 text-[var(--brand-300)]" : "text-current group-hover:bg-white/5"}`}>
                        {item.icon}
                      </span>
                      {!navCollapsed && <span className="truncate">{item.label}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>

      <div className="border-t border-[var(--border-inverse)] p-3">
        {!navCollapsed && (
          <div className="mb-2 rounded-[var(--radius-md)] border border-[var(--border-inverse)] bg-white/[0.025] p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-[10px] font-semibold text-[var(--text-inverse-muted)]">
                {isOnline ? <Wifi size={13} className="text-[var(--brand-300)]" /> : <WifiOff size={13} className="text-[var(--status-danger)]" />}
                {isOnline ? "Connected" : "Offline mode"}
              </span>
              {syncQueueCount > 0 && <span className="rounded-full bg-[var(--brand-400)]/15 px-2 py-0.5 text-[9px] font-bold text-[var(--brand-300)]">{syncQueueCount} queued</span>}
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={toggleCollapsed}
          className={`hidden h-9 w-full items-center rounded-[var(--radius-md)] text-[11px] font-medium text-[var(--text-inverse-muted)] transition hover:bg-[var(--surface-sidebar-hover)] hover:text-white md:flex ${navCollapsed ? "justify-center" : "gap-3 px-3"}`}
          aria-label={navCollapsed ? "Expand navigation" : "Collapse navigation"}
        >
          {navCollapsed ? <ChevronRight size={16} /> : <><ChevronLeft size={16} /><span>Collapse navigation</span></>}
        </button>
      </div>
    </>
  );

  return (
    <div className="flex h-dvh min-w-0 overflow-hidden bg-[var(--surface-canvas)] text-[var(--text-primary)]">
      <FormEnterNavigator />
      <a
        href="#main-content"
        className="fixed left-4 top-3 z-[110] -translate-y-20 rounded-[var(--radius-md)] bg-[var(--brand-600)] px-4 py-2 text-sm font-semibold text-white transition-transform focus:translate-y-0"
      >
        Skip to main content
      </a>

      <aside
        className={`relative z-[var(--z-sidebar)] hidden h-dvh shrink-0 flex-col overflow-hidden border-r border-[var(--border-inverse)] bg-[var(--surface-sidebar)] transition-[width] duration-200 ease-[var(--ease-standard)] md:flex ${
          collapsed ? "w-[var(--sidebar-collapsed)]" : "w-[var(--sidebar-expanded)]"
        }`}
      >
        {navContent}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-[var(--z-sidebar)] md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-[var(--surface-overlay)] backdrop-blur-[5px]"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          />
          <aside
            ref={mobileDrawerRef}
            id="mobile-primary-navigation"
            role="dialog"
            aria-modal="true"
            aria-label="Primary navigation"
            className="relative flex h-dvh w-[min(88vw,320px)] flex-col overflow-hidden bg-[var(--surface-sidebar)] shadow-[var(--shadow-dialog)]"
          >
            {navContent}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="relative z-[var(--z-topbar)] flex h-[var(--topbar-height)] shrink-0 items-center gap-3 border-b border-[var(--border-subtle)] bg-[var(--surface-topbar)] px-3 backdrop-blur-xl sm:px-5 lg:px-6">
          <button
            ref={mobileMenuButtonRef}
            type="button"
            onClick={() => setMobileOpen(true)}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-md)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] md:hidden"
            aria-label="Open navigation"
            aria-expanded={mobileOpen}
            aria-controls="mobile-primary-navigation"
          >
            <Menu size={19} />
          </button>

          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="hidden text-[11px] font-medium text-[var(--text-muted)] sm:inline">ZeroData CRM</span>
              <span className="hidden text-[var(--border-strong)] sm:inline">/</span>
              <span className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{activeItem?.label || "Workspace"}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setCommandOpen(true)}
            className="hidden h-9 min-w-[260px] max-w-[360px] items-center gap-2 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--surface-secondary)] px-3 text-left text-[12px] text-[var(--text-muted)] transition hover:border-[var(--border-strong)] hover:bg-[var(--surface-primary)] lg:flex"
            aria-label="Open global search"
          >
            <Search size={15} />
            <span className="flex-1">Search CRM</span>
            <kbd className="rounded border border-[var(--border-default)] bg-[var(--surface-primary)] px-1.5 py-0.5 text-[9px] font-semibold text-[var(--text-muted)]">Ctrl K</kbd>
          </button>

          <button
            type="button"
            onClick={() => setCommandOpen(true)}
            className="grid h-9 w-9 place-items-center rounded-[var(--radius-md)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] lg:hidden"
            aria-label="Search CRM"
          >
            <Search size={17} />
          </button>

          <button
            type="button"
            onClick={toggleTheme}
            className="grid h-9 w-9 place-items-center rounded-[var(--radius-md)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
            aria-label={`Use ${theme === "light" ? "dark" : "light"} theme`}
          >
            {theme === "light" ? <Moon size={17} /> : <Sun size={17} />}
          </button>

          <div ref={syncRef} className="relative">
            <button
              type="button"
              onClick={() => {
                setProfileOpen(false);
                setSyncOpen((open) => !open);
              }}
              className="relative grid h-9 w-9 place-items-center rounded-[var(--radius-md)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
              aria-label="Open sync status"
              aria-haspopup="dialog"
              aria-expanded={syncOpen}
            >
              {isOnline ? <Wifi size={17} /> : <WifiOff size={17} />}
              {(syncQueueCount > 0 || failedSyncCount > 0) && (
                <span className={`absolute right-1.5 top-1.5 h-2 w-2 rounded-full ring-2 ring-[var(--surface-primary)] ${failedSyncCount > 0 ? "bg-[var(--status-danger)]" : "bg-[var(--brand-500)]"}`} />
              )}
            </button>
            {syncOpen && (
              <div role="dialog" aria-label="Workspace sync status" className="absolute right-0 top-11 w-[300px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--surface-elevated)] shadow-[var(--shadow-popover)]">
                <div className="border-b border-[var(--border-subtle)] px-4 py-3">
                  <p className="text-[13px] font-semibold text-[var(--text-primary)]">Workspace status</p>
                  <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">Connectivity and offline sync queue</p>
                </div>
                <div className="space-y-2 p-3">
                  <div className="flex items-center gap-3 rounded-[var(--radius-md)] bg-[var(--surface-secondary)] p-3">
                    <span className={`grid h-8 w-8 place-items-center rounded-[var(--radius-md)] ${isOnline ? "bg-[var(--status-success-soft)] text-[var(--status-success)]" : "bg-[var(--status-danger-soft)] text-[var(--status-danger)]"}`}>
                      {isOnline ? <Wifi size={15} /> : <WifiOff size={15} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-semibold text-[var(--text-primary)]">{isOnline ? "Online" : "Offline"}</p>
                      <p className="text-[10px] text-[var(--text-muted)]">{isOnline ? "Changes can sync to the server." : "Changes stay safely in the local queue."}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-3">
                      <p className="text-[20px] font-semibold tabular-nums text-[var(--text-primary)]">{syncQueueCount}</p>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">Queued</p>
                    </div>
                    <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-3">
                      <p className={`text-[20px] font-semibold tabular-nums ${failedSyncCount ? "text-[var(--status-danger)]" : "text-[var(--text-primary)]"}`}>{failedSyncCount}</p>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">Needs review</p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div ref={profileRef} className="relative ml-1">
            <button
              type="button"
              onClick={() => {
                setSyncOpen(false);
                setProfileOpen((open) => !open);
              }}
              className="flex h-10 items-center gap-2 rounded-[var(--radius-md)] px-1.5 transition hover:bg-[var(--surface-hover)] sm:pr-2.5"
              aria-expanded={profileOpen}
              aria-haspopup="menu"
              aria-label="Open user menu"
            >
              <span className="grid h-8 w-8 place-items-center rounded-[10px] bg-[var(--brand-100)] text-[11px] font-bold text-[var(--brand-800)]">
                {isLoading ? "…" : initials}
              </span>
              <span className="hidden max-w-[150px] min-w-0 text-left sm:block">
                <span className="block truncate text-[11px] font-semibold text-[var(--text-primary)]">{currentUser?.name || "Loading account"}</span>
                <span className="block truncate text-[9px] text-[var(--text-muted)]">{roleLabel}</span>
              </span>
              <ChevronDown size={14} className="hidden text-[var(--text-muted)] sm:block" />
            </button>
            {profileOpen && (
              <div role="menu" aria-label="User menu" className="absolute right-0 top-12 w-[270px] overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--surface-elevated)] shadow-[var(--shadow-popover)]">
                <div className="border-b border-[var(--border-subtle)] p-4">
                  <div className="flex items-center gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-[var(--brand-100)] text-[12px] font-bold text-[var(--brand-800)]">{initials}</span>
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{currentUser?.name || "ZeroData user"}</p>
                      <p className="mt-0.5 truncate text-[10px] text-[var(--text-muted)]">{roleLabel}</p>
                    </div>
                  </div>
                </div>
                <div className="p-2">
                  <button
                    type="button"
                    role="menuitem"
                    onClick={toggleTheme}
                    className="flex w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-left text-[12px] font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
                  >
                    {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
                    Use {theme === "light" ? "dark" : "light"} theme
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setProfileOpen(false);
                      setLogoutOpen(true);
                    }}
                    className="flex w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-left text-[12px] font-medium text-[var(--status-danger)] hover:bg-[var(--status-danger-soft)]"
                  >
                    <LogOut size={16} />
                    Sign out securely
                  </button>
                  <p className="px-3 pb-2 text-[10px] leading-4 text-[var(--text-muted)]">
                    Use Logout to record your clock-out. Closing the browser does not complete attendance.
                  </p>
                </div>
              </div>
            )}
          </div>
        </header>

        <main id="main-content" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-7">{children}</div>
        </main>
      </div>

      <CommandPalette items={commandItems} open={commandOpen} onOpenChange={setCommandOpen} />
      <VerifiedLogoutModal open={logoutOpen} onClose={() => setLogoutOpen(false)} />
    </div>
  );
}
