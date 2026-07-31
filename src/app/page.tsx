"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Headphones,
  Link2,
  ListTodo,
  MessageSquare,
  PhoneCall,
  ShieldCheck,
  TrendingUp,
  UserPlus,
  Users,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/db";
import { DashboardPageTemplate } from "@/components/templates/DashboardPageTemplate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { MetricCard } from "@/components/ui/MetricCard";
import { EmptyState } from "@/components/ui/EmptyState";

interface ActivityItem {
  id: string;
  type: "lead" | "query" | "call";
  title: string;
  detail: string;
  time: string;
  status: string;
  date: Date;
}

export default function HomePage() {
  const { currentUser, capabilities, isAdmin, hasOnboarding, hasSupport } = useAuth();
  const [totalLeads, setTotalLeads] = useState(0);
  const [conversionRate, setConversionRate] = useState(0);
  const [pendingQueries, setPendingQueries] = useState(0);
  const [activeUsersCount, setActiveUsersCount] = useState(0);
  const [recentActivities, setRecentActivities] = useState<ActivityItem[]>([]);
  const [mappedTasksCount, setMappedTasksCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadStats() {
      try {
        if (!currentUser) return;
        const canViewTeamOperations = isAdmin || hasOnboarding || hasSupport;
        const visibleCalls = isAdmin
          ? db.call_logs.toArray()
          : db.call_logs.where("user_id").equals(currentUser.user_id).toArray();
        const visibleQueries = isAdmin || hasSupport
          ? db.client_queries.toArray()
          : db.client_queries.where("assigned_to").equals(currentUser.user_id).toArray();
        const visibleLeads = canViewTeamOperations
          ? db.leads.toArray()
          : db.leads.where("assigned_to").equals(currentUser.user_id).toArray();
        const visibleUsers = isAdmin || capabilities.includes("task_assigner")
          ? db.users.toArray()
          : db.users.where("user_id").equals(currentUser.user_id).toArray();
        const [leads, queries, calls, users] = await Promise.all([
          visibleLeads,
          visibleQueries,
          visibleCalls,
          visibleUsers,
        ]);

        setTotalLeads(leads.length);
        const convertedLeads = leads.filter((lead) =>
          ["Registration", "Installation", "Payment"].includes(lead.status)
        ).length;
        setConversionRate(leads.length ? Number(((convertedLeads / leads.length) * 100).toFixed(1)) : 0);
        setPendingQueries(queries.filter((query) => query.problem_status !== "Resolved").length);
        setActiveUsersCount(users.filter((user) => user.is_active !== 0).length);

        const leadNames = new Map(leads.map((lead) => [lead.lead_id, lead.business_name]));
        const feed: ActivityItem[] = [];

        leads.slice().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 3).forEach((lead) => {
          const date = new Date(lead.created_at);
          feed.push({
            id: `lead-${lead.lead_id}`,
            type: "lead",
            title: lead.business_name,
            detail: "Lead record updated",
            time: date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            status: lead.status,
            date,
          });
        });

        queries.slice().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 3).forEach((query) => {
          const date = new Date(query.created_at);
          feed.push({
            id: `query-${query.query_id}`,
            type: "query",
            title: leadNames.get(query.client_username) || "Client query",
            detail: "Support request activity",
            time: date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            status: query.problem_status,
            date,
          });
        });

        calls.slice().sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 3).forEach((call) => {
          const date = new Date(call.timestamp);
          feed.push({
            id: `call-${call.log_id}`,
            type: "call",
            title: call.client_name || (call.lead_id ? leadNames.get(call.lead_id) : null) || "Client call",
            detail: "Call outcome recorded",
            time: date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            status: call.outcome,
            date,
          });
        });

        setRecentActivities(feed.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 7));

        if (currentUser && (isAdmin || capabilities.includes("mapping"))) {
          const mappingRequests = await db.mapping_requests.toArray();
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 1);
          setMappedTasksCount(
            mappingRequests.filter((mapping) => {
              if (mapping.status !== "Completed" || !mapping.completed_at || mapping.mapped_by !== currentUser.user_id) return false;
              const completionDate = new Date(mapping.completed_at);
              return completionDate >= today && completionDate < tomorrow;
            }).length
          );
        }
      } catch (error) {
        console.error("Failed to load dashboard metrics", error);
      } finally {
        setLoading(false);
      }
    }
    loadStats();
  }, [currentUser, isAdmin, capabilities, hasOnboarding, hasSupport]);

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good morning";
    if (hour < 17) return "Good afternoon";
    return "Good evening";
  }, []);

  const activityMeta = {
    lead: { icon: <TrendingUp size={15} />, tone: "bg-[var(--brand-50)] text-[var(--brand-700)]" },
    query: { icon: <Headphones size={15} />, tone: "bg-[var(--status-info-soft)] text-[var(--status-info)]" },
    call: { icon: <PhoneCall size={15} />, tone: "bg-[var(--status-warning-soft)] text-[var(--status-warning)]" },
  } as const;

  return (
    <DashboardPageTemplate
      headerTitle={`${greeting}, ${currentUser?.name?.split(" ")[0] || "team"}.`}
      headerSubtitle="A decision-first view of today’s pipeline, service workload, team activity, and operational priorities."
      headerEyebrow="ZeroData operations"
      headerIcon={<BarChart3 size={16} />}
      primaryAction={
        <Link href="/my-day">
          <Button trailingIcon={<ArrowRight size={15} />}>Open My Day</Button>
        </Link>
      }
      headerMeta={
        <>
          <Chip variant={pendingQueries > 0 ? "warning" : "success"} size="sm" dot>
            {pendingQueries > 0 ? `${pendingQueries} support items open` : "Support queue clear"}
          </Chip>
          <Chip variant="neutral" size="sm">{activeUsersCount} active team members</Chip>
        </>
      }
      attentionQueue={
        pendingQueries > 0 ? (
          <div className="flex flex-col gap-4 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--status-warning)]/20 bg-[linear-gradient(110deg,var(--status-warning-soft),var(--surface-primary))] p-5 shadow-[var(--shadow-raised)] sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-4">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--surface-primary)] text-[var(--status-warning)] shadow-sm">
                <MessageSquare size={18} />
              </span>
              <div>
                <p className="text-[13px] font-semibold text-[var(--text-primary)]">Client support needs attention</p>
                <p className="mt-1 text-[12px] leading-5 text-[var(--text-muted)]">{pendingQueries} unresolved {pendingQueries === 1 ? "request is" : "requests are"} waiting in the service queue.</p>
              </div>
            </div>
            {hasSupport && (
              <Link href="/support"><Button variant="outline" size="sm" trailingIcon={<ArrowRight size={14} />}>Review queue</Button></Link>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-[var(--status-success)]/20 bg-[var(--status-success-soft)] p-4">
            <span className="grid h-9 w-9 place-items-center rounded-[var(--radius-md)] bg-[var(--surface-primary)] text-[var(--status-success)]"><CheckCircle2 size={17} /></span>
            <div><p className="text-[13px] font-semibold text-[var(--text-primary)]">No urgent service blockers</p><p className="mt-0.5 text-[11px] text-[var(--text-muted)]">The current support queue has no unresolved client requests.</p></div>
          </div>
        )
      }
      kpis={
        <div className="metric-grid">
          <MetricCard label="Managed leads" value={loading ? "—" : totalLeads} icon={<Users size={17} />} note="Across retailer and distributor onboarding" />
          <MetricCard label="Conversion" value={loading ? "—" : `${conversionRate}%`} icon={<TrendingUp size={17} />} note="Leads at registration, installation, or payment" tone="success" trend={conversionRate >= 50 ? "Healthy" : "Build momentum"} />
          <MetricCard label="Open queries" value={loading ? "—" : pendingQueries} icon={<MessageSquare size={17} />} note="Client requests not yet marked resolved" tone={pendingQueries > 0 ? "warning" : "success"} />
          <MetricCard label="Active team" value={loading ? "—" : activeUsersCount} icon={<ShieldCheck size={17} />} note="Users currently enabled in the workspace" tone="info" />
        </div>
      }
      mainContent={
        <>
          <Card className="overflow-hidden p-0">
            <CardHeader className="mb-0 border-b border-[var(--border-subtle)] px-5 py-4">
              <div>
                <CardTitle className="flex items-center gap-2"><Activity size={17} className="text-[var(--brand-600)]" /> Recent operational activity</CardTitle>
                <p className="mt-1 text-[11px] text-[var(--text-muted)]">The latest changes across leads, calls, and support.</p>
              </div>
              <Chip variant="success" size="sm" dot>Live workspace</Chip>
            </CardHeader>
            <CardContent>
              {recentActivities.length ? (
                <div>
                  {recentActivities.map((activity, index) => {
                    const meta = activityMeta[activity.type];
                    return (
                      <div key={activity.id} className={`group flex items-center gap-3 px-5 py-4 transition hover:bg-[var(--surface-hover)] ${index ? "border-t border-[var(--border-subtle)]" : ""}`}>
                        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-md)] ${meta.tone}`}>{meta.icon}</span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{activity.title}</p>
                          <p className="mt-0.5 truncate text-[11px] text-[var(--text-muted)]">{activity.detail} · {activity.time}</p>
                        </div>
                        <Chip variant="neutral" size="sm">{activity.status}</Chip>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-5"><EmptyState title="No recent activity" description="New calls, lead updates, and support activity will appear here." className="border-0" /></div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div><CardTitle>Pipeline health</CardTitle><p className="mt-1 text-[11px] text-[var(--text-muted)]">A compact read on current conversion momentum.</p></div>
              {hasOnboarding && <Link href="/onboarding" className="text-[11px] font-semibold text-[var(--brand-600)] hover:text-[var(--brand-700)]">Open pipeline →</Link>}
            </CardHeader>
            <div className="grid gap-5 md:grid-cols-[1fr_220px] md:items-center">
              <div>
                <div className="flex items-end justify-between gap-4"><span className="text-[32px] font-semibold tracking-[-0.05em] text-[var(--text-primary)]">{conversionRate}%</span><span className="text-[11px] font-medium text-[var(--text-muted)]">Current conversion</span></div>
                <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-[var(--surface-tertiary)]"><div className="h-full rounded-full bg-[var(--brand-500)] transition-[width] duration-500" style={{ width: `${Math.min(conversionRate, 100)}%` }} /></div>
                <div className="mt-4 flex flex-wrap gap-2"><Chip variant="brand" size="sm">{totalLeads} total leads</Chip><Chip variant="neutral" size="sm">{mappedTasksCount} mapped today</Chip></div>
              </div>
              <div className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-4">
                <p className="section-kicker">Focus signal</p>
                <p className="mt-3 text-[13px] font-semibold text-[var(--text-primary)]">{conversionRate >= 50 ? "Protect conversion quality" : "Increase stage movement"}</p>
                <p className="mt-1 text-[11px] leading-5 text-[var(--text-muted)]">{conversionRate >= 50 ? "Keep next actions current and resolve blockers quickly." : "Prioritise contacted and interested leads with overdue follow-ups."}</p>
              </div>
            </div>
          </Card>
        </>
      }
      contextPanel={
        <>
          <Card>
            <CardHeader><div><CardTitle>Quick actions</CardTitle><p className="mt-1 text-[11px] text-[var(--text-muted)]">Jump into the highest-frequency workflows.</p></div></CardHeader>
            <div className="space-y-2">
              <Link href="/my-day" className="group flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-3 transition hover:border-[var(--brand-200)] hover:bg-[var(--brand-50)]">
                <span className="grid h-9 w-9 place-items-center rounded-[var(--radius-md)] bg-[var(--brand-50)] text-[var(--brand-700)]"><ListTodo size={16} /></span><span className="min-w-0 flex-1"><span className="block text-[12px] font-semibold text-[var(--text-primary)]">Review My Day</span><span className="block text-[10px] text-[var(--text-muted)]">Tasks and field targets</span></span><ArrowRight size={15} className="text-[var(--text-disabled)] transition group-hover:translate-x-0.5 group-hover:text-[var(--brand-600)]" />
              </Link>
              <Link href="/call-logs" className="group flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-3 transition hover:border-[var(--brand-200)] hover:bg-[var(--brand-50)]">
                <span className="grid h-9 w-9 place-items-center rounded-[var(--radius-md)] bg-[var(--status-warning-soft)] text-[var(--status-warning)]"><PhoneCall size={16} /></span><span className="min-w-0 flex-1"><span className="block text-[12px] font-semibold text-[var(--text-primary)]">Log a call</span><span className="block text-[10px] text-[var(--text-muted)]">Outcome and next follow-up</span></span><ArrowRight size={15} className="text-[var(--text-disabled)] transition group-hover:translate-x-0.5 group-hover:text-[var(--brand-600)]" />
              </Link>
              {hasSupport && <Link href="/mappings" className="group flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-3 transition hover:border-[var(--brand-200)] hover:bg-[var(--brand-50)]"><span className="grid h-9 w-9 place-items-center rounded-[var(--radius-md)] bg-[var(--status-info-soft)] text-[var(--status-info)]"><Link2 size={16} /></span><span className="min-w-0 flex-1"><span className="block text-[12px] font-semibold text-[var(--text-primary)]">Create mapping</span><span className="block text-[10px] text-[var(--text-muted)]">Distributor and retailer link</span></span><ArrowRight size={15} className="text-[var(--text-disabled)]" /></Link>}
              {isAdmin && <Link href="/manager/tasks" className="group flex items-center gap-3 rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-3 transition hover:border-[var(--brand-200)] hover:bg-[var(--brand-50)]"><span className="grid h-9 w-9 place-items-center rounded-[var(--radius-md)] bg-[var(--status-pending-soft)] text-[var(--status-pending)]"><UserPlus size={16} /></span><span className="min-w-0 flex-1"><span className="block text-[12px] font-semibold text-[var(--text-primary)]">Allocate tasks</span><span className="block text-[10px] text-[var(--text-muted)]">Assign team execution</span></span><ArrowRight size={15} className="text-[var(--text-disabled)]" /></Link>}
            </div>
          </Card>

          <Card variant="muted">
            <CardHeader><div><CardTitle>Today&apos;s focus</CardTitle><p className="mt-1 text-[11px] text-[var(--text-muted)]">A concise operating checklist.</p></div></CardHeader>
            <div className="space-y-3">
              {[
                { label: "Review pending tasks", value: "My Day", done: false },
                { label: "Resolve client blockers", value: `${pendingQueries} open`, done: pendingQueries === 0 },
                { label: "Keep mapping queue current", value: `${mappedTasksCount} done`, done: mappedTasksCount > 0 },
              ].map((item) => (
                <div key={item.label} className="flex items-center gap-3">
                  <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full ${item.done ? "bg-[var(--status-success-soft)] text-[var(--status-success)]" : "border border-[var(--border-default)] bg-[var(--surface-primary)] text-[var(--text-disabled)]"}`}><CheckCircle2 size={13} /></span>
                  <span className="min-w-0 flex-1 text-[11px] font-medium text-[var(--text-secondary)]">{item.label}</span>
                  <span className="text-[10px] font-semibold text-[var(--text-muted)]">{item.value}</span>
                </div>
              ))}
            </div>
          </Card>
        </>
      }
    />
  );
}
