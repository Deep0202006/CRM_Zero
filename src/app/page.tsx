"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db } from "@/lib/db";
import {
  BarChart3,
  TrendingUp,
  Users,
  Activity,
  PhoneCall,
  MessageSquare,
  AlertCircle,
  Clock,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
} from "lucide-react";
import Link from "next/link";
import { DashboardPageTemplate } from "@/components/templates/DashboardPageTemplate";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";

export default function HomePage() {
  const { currentUser, capabilities, isAdmin, hasOnboarding, hasSupport } = useAuth();
  
  const [totalLeads, setTotalLeads] = useState(0);
  const [conversionRate, setConversionRate] = useState("0%");
  const [pendingQueries, setPendingQueries] = useState(0);
  const [activeUsersCount, setActiveUsersCount] = useState(0);
  const [recentActivities, setRecentActivities] = useState<any[]>([]);
  const [mappedTasksCount, setMappedTasksCount] = useState(0);

  useEffect(() => {
    async function loadStats() {
      try {
        const leads = await db.leads.toArray();
        const queries = await db.client_queries.toArray();
        const calls = await db.call_logs.toArray();
        const users = await db.users.toArray();
        
        setTotalLeads(leads.length);

        if (leads.length > 0) {
          const convertedLeads = leads.filter(
            (l) => l.status === "Installation" || l.status === "Payment" || l.status === "Registration"
          ).length;
          setConversionRate(((convertedLeads / leads.length) * 100).toFixed(1) + "%");
        } else {
          setConversionRate("0%");
        }

        const pending = queries.filter((q) => q.problem_status !== "Resolved").length;
        setPendingQueries(pending);

        const activeUsers = users.filter((u) => u.is_active !== 0).length;
        setActiveUsersCount(activeUsers);

        const feed: any[] = [];
        
        leads.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        leads.slice(0, 2).forEach((l) => {
          feed.push({
            type: "lead",
            title: `Lead Activity: ${l.business_name}`,
            time: new Date(l.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            status: l.status,
            date: new Date(l.created_at),
          });
        });
        
        queries.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        queries.slice(0, 2).forEach((q) => {
          feed.push({
            type: "query",
            title: `Client Query: ${leads.find((l) => l.lead_id === q.client_username)?.business_name || "Unknown"}`,
            time: new Date(q.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            status: q.problem_status,
            date: new Date(q.created_at),
          });
        });

        calls.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        calls.slice(0, 2).forEach((c) => {
          feed.push({
            type: "call",
            title: `Call Logged: ${leads.find((l) => l.lead_id === c.lead_id)?.business_name || "Unknown"}`,
            time: new Date(c.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
            status: c.outcome,
            date: new Date(c.timestamp),
          });
        });

        feed.sort((a, b) => b.date.getTime() - a.date.getTime());
        setRecentActivities(feed.slice(0, 5));
        
        if (currentUser && (isAdmin || capabilities.includes("mapping"))) {
          const mappingRequests = await db.mapping_requests.toArray();
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 1);
          
          const mappedToday = mappingRequests.filter((m) => {
            if (m.status !== "Completed" || !m.completed_at) return false;
            if (m.mapped_by !== currentUser.user_id) return false;
            const completionDate = new Date(m.completed_at);
            return completionDate >= today && completionDate < tomorrow;
          }).length;
          setMappedTasksCount(mappedToday);
        }
      } catch (err) {
        console.error("Failed to load dashboard metrics", err);
      }
    }
    loadStats();
  }, [currentUser, isAdmin, capabilities]);

  const metrics = [
    { label: "Total Leads Managed", value: totalLeads.toString(), trend: "Active", icon: BarChart3 },
    { label: "Conversion Rate", value: conversionRate, trend: "Target Match", icon: TrendingUp },
    { label: "Open Client Queries", value: pendingQueries.toString(), trend: "SLA Active", icon: MessageSquare },
    { label: "Active Team Members", value: activeUsersCount.toString(), trend: "Live", icon: Users },
  ];

  if (isAdmin || capabilities.includes("mapping")) {
    metrics.push({ label: "Mapped Tasks (Today)", value: mappedTasksCount.toString(), trend: "Daily", icon: Activity });
  }

  return (
    <DashboardPageTemplate
      headerTitle={`Welcome back, ${currentUser?.name || "Corporate Agent"}`}
      headerSubtitle="CRM Zero Operations Desk & Activity Stream"
      primaryAction={
        <Link href="/my-day">
          <Button icon={<ArrowRight size={14} />}>Go to My Day</Button>
        </Link>
      }
      kpis={
        (isAdmin || (hasOnboarding && hasSupport)) ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {metrics.slice(0, 4).map((m) => (
              <Card key={m.label} className="p-4 flex flex-col justify-between space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-wider">
                    {m.label}
                  </span>
                  <m.icon size={16} className="text-[var(--brand-500)] shrink-0" />
                </div>
                <div>
                  <p className="text-2xl font-black text-[var(--text-primary)] font-mono">{m.value}</p>
                </div>
                <div className="pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between">
                  <span className="text-[10px] text-[var(--text-muted)] font-semibold">Status</span>
                  <Chip variant="brand" size="sm">
                    {m.trend}
                  </Chip>
                </div>
              </Card>
            ))}
          </div>
        ) : undefined
      }
      mainContent={
        <Card className="space-y-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity size={18} className="text-[var(--brand-500)]" />
              Recent Operational Activity
            </CardTitle>
            <span className="h-2 w-2 rounded-full bg-[var(--status-success)] animate-pulse" />
          </CardHeader>
          <CardContent>
            {recentActivities.length > 0 ? (
              <div className="space-y-3">
                {recentActivities.map((act, idx) => (
                  <div
                    key={idx}
                    className="p-3.5 bg-[var(--surface-secondary)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] flex items-center justify-between hover:border-[var(--border-default)] transition-all"
                  >
                    <div className="flex items-center space-x-3">
                      <div
                        className={`h-2 w-2 rounded-full ${
                          act.type === "lead"
                            ? "bg-[var(--brand-500)]"
                            : act.type === "call"
                            ? "bg-[var(--status-warning)]"
                            : "bg-[var(--status-info)]"
                        }`}
                      />
                      <div>
                        <p className="text-xs font-bold text-[var(--text-primary)]">{act.title}</p>
                        <p className="text-[10px] text-[var(--text-muted)] font-semibold">{act.time}</p>
                      </div>
                    </div>
                    <Chip variant="neutral" size="sm">
                      {act.status}
                    </Chip>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-10 text-xs text-[var(--text-muted)] italic font-semibold">
                No recent activity recorded today.
              </div>
            )}
          </CardContent>
        </Card>
      }
      contextPanel={
        <Card className="space-y-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck size={18} className="text-[var(--brand-500)]" />
              Quick System Actions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Link href="/my-day" className="block">
              <Button variant="secondary" className="w-full justify-start text-xs font-bold">
                View My Tasks & Targets
              </Button>
            </Link>
            <Link href="/call-logs" className="block">
              <Button variant="secondary" className="w-full justify-start text-xs font-bold">
                Log New Call Outcome
              </Button>
            </Link>
            {hasSupport && (
              <Link href="/mappings" className="block">
                <Button variant="secondary" className="w-full justify-start text-xs font-bold">
                  Distributor-Retailer Mappings
                </Button>
              </Link>
            )}
            {isAdmin && (
              <Link href="/manager/tasks" className="block">
                <Button variant="secondary" className="w-full justify-start text-xs font-bold">
                  Bulk Task Allocation (Excel)
                </Button>
              </Link>
            )}
          </CardContent>
        </Card>
      }
    />
  );
}
