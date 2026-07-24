"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db, LocalFieldVisit, LocalUser, LocalLead } from "@/lib/db";
import { getCurrentISTDate } from "@/lib/dateTime";
import { MapPin, CheckCircle2, User, Download, Calendar } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { QueueList } from "@/components/QueueList";
import { MetricCard } from "@/components/ui/MetricCard";
import { Button } from "@/components/ui/Button";

export default function AdminVisitsPage() {
  const { currentUser, isAdmin } = useAuth();
  
  const [loading, setLoading] = useState(true);
  const [visits, setVisits] = useState<LocalFieldVisit[]>([]);
  const [usersMap, setUsersMap] = useState<Map<string, LocalUser>>(new Map());
  const [leadsMap, setLeadsMap] = useState<Map<string, LocalLead>>(new Map());

  const loadData = async () => {
    if (!isAdmin) return;
    try {
      const fetchedVisits = await db.field_visits.toArray();
      fetchedVisits.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      
      const allUsers = await db.users.toArray();
      const uMap = new Map<string, LocalUser>();
      allUsers.forEach(u => uMap.set(u.user_id, u));
      
      const allLeads = await db.leads.toArray();
      const lMap = new Map<string, LocalLead>();
      allLeads.forEach(l => lMap.set(l.lead_id, l));
      
      setUsersMap(uMap);
      setLeadsMap(lMap);
      setVisits(fetchedVisits);
    } catch (err) {
      console.error("Failed to load admin visits:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [isAdmin]);

  const getLeadDisplay = (lead_id: string) => {
    if (lead_id.startsWith("EXCEL::")) {
      const parts = lead_id.split("::");
      if (parts.length === 3) return `${parts[2]} (@${parts[1]})`;
    }
    const lead = leadsMap.get(lead_id);
    if (lead) {
      if (lead.business_name.includes("(@")) return lead.business_name;
      return `${lead.business_name} - ${lead.phone || "N/A"}`;
    }
    return lead_id;
  };

  const getAgentDisplay = (user_id: string) => {
    const user = usersMap.get(user_id);
    if (!user) return "Unknown Agent";
    return `${user.name} (@${user.email})`;
  };

  if (!isAdmin) {
    return (
      <div className="app-page">
        <PageHeader eyebrow="Security" title="Access Denied" description="You do not have permission to view this page." />
      </div>
    );
  }

  const todayKey = getCurrentISTDate();
  const visitsToday = visits.filter((v) => v.visit_date === todayKey).length;
  const uniqueUsers = new Set(visits.map(v => v.user_id)).size;

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Field Operations"
        icon={<MapPin size={18} />}
        title="Team Field Visits"
        description="Monitor field visit compliance, check-ins, and outcomes across the organization."
        actions={
          <Button size="sm" variant="outline" icon={<Download size={14} />}>
            Export to CSV
          </Button>
        }
      />

      <div className="metric-grid">
        <MetricCard label="Total Visits" value={visits.length} icon={<MapPin size={17} />} note="All recorded visits" />
        <MetricCard label="Visits Today" value={visitsToday} icon={<Calendar size={17} />} tone="success" note="Recorded in the current calendar day" />
        <MetricCard label="Active Field Reps" value={uniqueUsers} icon={<User size={17} />} tone="brand" note="Reps with at least one visit logged" />
      </div>

      <div className="workspace-split">
        <QueueList
          title="Field Visit History"
          items={visits.map((visit) => ({
            id: visit.visit_id,
            primaryNode: (
              <div>
                <p className="text-[13px] font-semibold leading-snug text-[var(--text-primary)]">{getLeadDisplay(visit.lead_id)}</p>
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
                  Rep · <span className="normal-case tracking-normal text-[var(--text-secondary)]">{getAgentDisplay(visit.user_id)}</span>
                </p>
                <div className="mt-2 text-[11px] text-[var(--text-secondary)] flex gap-4">
                  <span>Coordinates: {visit.check_in_lat ? `${visit.check_in_lat.toFixed(5)}, ${visit.check_in_lng?.toFixed(5)}` : "None"}</span>
                  {visit.check_in_photo_url && <span className="text-[var(--brand-600)]">Has Photo Proof</span>}
                </div>
                {visit.visit_notes && <p className="mt-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-primary)] p-2.5 text-[12px] leading-5 text-[var(--text-secondary)]">{visit.visit_notes}</p>}
              </div>
            ),
            statusText: visit.visit_outcome,
            statusVariant: "brand",
            timestamp: new Date(visit.check_in_time).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
          }))}
          emptyMessage={loading ? "Loading visits…" : "No field visits found."}
          onRefresh={loadData}
        />
      </div>
    </div>
  );
}
