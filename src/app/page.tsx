"use client";

import React, { useState, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/lib/db';
import { 
  BarChart, 
  TrendingUp, 
  Clock, 
  Users, 
  Activity, 
  ArrowUpRight, 
  AlertTriangle,
  PhoneCall,
  MessageSquare
} from 'lucide-react';
import Link from 'next/link';

export default function HomePage() {
  const { currentUser, capabilities, isAdmin, hasOnboarding, hasSupport, isFieldStaff } = useAuth();
  
  // Real-time DB metrics
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
        
        // 1. Total Leads
        setTotalLeads(leads.length);

        // 2. Conversion Rate (leads in final stages: Installation/Payment/Registration vs Total)
        if (leads.length > 0) {
          const convertedLeads = leads.filter(l => 
            l.status === 'Installation' || 
            l.status === 'Payment' || 
            l.status === 'Registration'
          ).length;
          setConversionRate(((convertedLeads / leads.length) * 100).toFixed(1) + "%");
        } else {
          setConversionRate("0%");
        }

        // 3. Pending Queries
        const pending = queries.filter(q => q.problem_status !== 'Resolved').length;
        setPendingQueries(pending);

        // 4. Active Users
        const activeUsers = users.filter(u => u.is_active !== 0).length;
        setActiveUsersCount(activeUsers);

        // 5. Activity Log list from DB
        const feed: any[] = [];
        
        // Latest leads
        leads.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        leads.slice(0, 2).forEach(l => {
          feed.push({
            type: "lead",
            title: `Lead Activity: ${l.business_name}`,
            time: new Date(l.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            status: l.status,
            date: new Date(l.created_at)
          });
        });
        
        // Latest queries
        queries.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
        queries.slice(0, 2).forEach(q => {
          feed.push({
            type: "query",
            title: `Client Query: ${leads.find(l => l.lead_id === q.client_username)?.business_name || 'Unknown'}`,
            time: new Date(q.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            status: q.problem_status,
            date: new Date(q.created_at)
          });
        });

        // Latest calls
        calls.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        calls.slice(0, 2).forEach(c => {
          feed.push({
            type: "call",
            title: `Call Logged: ${leads.find(l => l.lead_id === c.lead_id)?.business_name || 'Unknown'}`,
            time: new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            status: c.outcome,
            date: new Date(c.timestamp)
          });
        });

        // Sort combined feed
        feed.sort((a, b) => b.date.getTime() - a.date.getTime());
        setRecentActivities(feed.slice(0, 5));
        
        if (currentUser && (isAdmin || capabilities.includes('mapping'))) {
          const mappingRequests = await db.mapping_requests.toArray();
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const tomorrow = new Date(today);
          tomorrow.setDate(tomorrow.getDate() + 1);
          
          const mappedToday = mappingRequests.filter(m => {
            if (m.status !== "Completed" || !m.completed_at) return false;
            // The mapping module user completion check
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
    { label: 'Total Leads Managed', value: totalLeads.toString(), trend: '+12%', color: 'text-brand-primary', icon: BarChart },
    { label: 'Conversion Rate', value: conversionRate, trend: 'Optimal', color: 'text-status-success', icon: TrendingUp },
    { label: 'Open Client Queries', value: pendingQueries.toString(), trend: 'SLA Active', color: 'text-brand-secondary', icon: MessageSquare },
    { label: 'Active Team Members', value: activeUsersCount.toString(), trend: 'Live', color: 'text-status-pending', icon: Users },
  ];

  if (isAdmin || capabilities.includes('mapping')) {
    metrics.push({ label: 'Mapped Tasks (Today)', value: mappedTasksCount.toString(), trend: 'Daily', color: 'text-brand-primary', icon: Activity });
  }

  return (
    <div className="space-y-8">
      {/* Welcome Banner */}
      <div className="bg-white/80 backdrop-blur-xl border border-white/40 p-6 rounded-3xl shadow-[0_8px_32px_0_rgba(31,38,135,0.02)]">
        <h2 className="text-xl md:text-2xl font-black text-slate-900 leading-tight">
          Welcome back, {currentUser?.name || "Corporate Agent"}
        </h2>
        <p className="text-slate-600 text-xs mt-1 font-medium">
          Nexus operations center is running normally. All local databases are synced offline.
        </p>
      </div>

      {/* KPI Cards (Glassmorphism) - Only show to Admins or if they have both Onboarding and Support */}
      {(isAdmin || (hasOnboarding && hasSupport)) && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {metrics.map((m) => (
            <div key={m.label} className="bg-white/75 backdrop-blur-xl border border-white/40 p-6 rounded-3xl shadow-[0_8px_32px_0_rgba(31,38,135,0.03)] flex flex-col justify-between hover:shadow-[0_12px_40px_0_rgba(31,38,135,0.06)] transition-all">
              <div>
                <div className="flex justify-between items-start mb-4">
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest leading-none">{m.label}</p>
                  <div className={`p-1.5 rounded-lg bg-slate-50 border border-slate-200/40 ${m.color}`}>
                    <m.icon size={16} />
                  </div>
                </div>
                <h4 className="text-3xl font-black text-slate-900 leading-none">{m.value}</h4>
              </div>
              <div className="mt-4 pt-3 border-t border-slate-100/60 flex items-center justify-between">
                <span className="text-[10px] text-slate-400 font-bold">Performance Status</span>
                <span className={`text-[10px] font-black px-2 py-0.5 rounded-md bg-slate-50 border border-slate-200/60 ${m.color}`}>
                  {m.trend}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Two Columns Section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Main Info Desk */}
        <div className="lg:col-span-8 bg-white rounded-3xl border border-slate-100 p-6 md:p-8 shadow-sm space-y-6">
          <div className="flex justify-between items-center pb-4 border-b border-slate-50">
            <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
              <Activity size={18} className="text-brand-primary" />
              Recent Operational Activity
            </h3>
            <span className="h-2 w-2 rounded-full bg-status-success animate-pulse" />
          </div>

          {recentActivities.length > 0 ? (
            <div className="space-y-4">
              {recentActivities.map((act, idx) => (
                <div key={idx} className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between hover:border-brand-primary/20 transition-all">
                  <div className="flex items-center space-x-3">
                    <div className={`h-2 w-2 rounded-full ${act.type === 'lead' ? 'bg-brand-primary' : act.type === 'call' ? 'bg-amber-500' : 'bg-brand-secondary'}`}></div>
                    <div>
                      <p className="text-xs font-bold text-slate-900">{act.title}</p>
                      <p className="text-[10px] text-slate-400 font-bold">{act.time}</p>
                    </div>
                  </div>
                  <span className="text-[9px] font-black uppercase bg-white px-2 py-0.5 rounded-md border border-slate-200/80 text-slate-600">
                    {act.status}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-10">
              <p className="text-xs text-slate-400 font-bold italic">No recent local database mutations found.</p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4">
            {hasOnboarding && (
              <Link href="/onboarding" className="p-4 bg-slate-50 hover:bg-brand-primary/5 hover:border-brand-primary/20 border border-slate-100 rounded-2xl flex flex-col justify-between transition-all group">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Leads Pipeline</span>
                <span className="text-xs font-black text-slate-900 group-hover:text-brand-primary mt-2 block flex items-center gap-1">
                  Manage Kanban <ArrowUpRight size={14} />
                </span>
              </Link>
            )}
            
            {hasSupport && (
              <Link href="/support" className="p-4 bg-slate-50 hover:bg-brand-primary/5 hover:border-brand-primary/20 border border-slate-100 rounded-2xl flex flex-col justify-between transition-all group">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Support Portal</span>
                <span className="text-xs font-black text-slate-900 group-hover:text-brand-primary mt-2 block flex items-center gap-1">
                  Manage Queries <ArrowUpRight size={14} />
                </span>
              </Link>
            )}

            <Link href="/my-day" className="p-4 bg-slate-50 hover:bg-brand-primary/5 hover:border-brand-primary/20 border border-slate-100 rounded-2xl flex flex-col justify-between transition-all group">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">My Day</span>
              <span className="text-xs font-black text-slate-900 group-hover:text-brand-primary mt-2 block flex items-center gap-1">
                Tasks & Performance <ArrowUpRight size={14} />
              </span>
            </Link>
          </div>
        </div>

        {/* Sidebar Info Desk */}
        <div className="lg:col-span-4 bg-slate-50 rounded-3xl p-6 border border-slate-200/50 space-y-6 flex flex-col">
          <div>
            <h3 className="font-bold text-slate-900 mb-2 flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-500" />
              Assigned Permissions
            </h3>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Access levels configuration rules</p>
          </div>

          <div className="bg-white p-4 rounded-2xl border border-slate-100 space-y-3 flex-1">
            {capabilities.length > 0 ? (
              capabilities.map((cap) => (
                <div key={cap} className="flex justify-between items-center text-xs">
                  <span className="font-mono text-[10px] bg-slate-50 border border-slate-200 px-2 py-0.5 rounded text-slate-600 font-bold">
                    {cap}
                  </span>
                  <span className="text-status-success font-bold text-[10px] uppercase">Active</span>
                </div>
              ))
            ) : (
              <p className="text-xs italic text-slate-400 text-center py-4 font-bold">No custom operational capability assigned.</p>
            )}
            {isAdmin && (
              <div className="flex justify-between items-center text-xs border-t border-slate-50 pt-2">
                <span className="font-mono text-[10px] bg-brand-primary/10 border border-brand-primary/20 text-brand-primary px-2 py-0.5 rounded font-bold">
                  admin_bypass
                </span>
                <span className="text-brand-primary font-bold text-[10px] uppercase">Superuser</span>
              </div>
            )}
          </div>

          <div className="p-4 bg-white/70 border border-white/50 rounded-2xl text-[11px] leading-relaxed text-slate-500 font-medium">
             Security policies are verified server-side on every sync operation. Capability logs are tracked by the main system audit.
          </div>
        </div>
      </div>
    </div>
  );
}
