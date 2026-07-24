"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { db, LocalFieldVisit, LocalLead } from "@/lib/db";
import { MapPin, Plus, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import Link from "next/link";
import { PageHeader } from "@/components/ui/PageHeader";
import { QueueList } from "@/components/QueueList";
import { MetricCard } from "@/components/ui/MetricCard";
import { CheckInGate } from "@/components/CheckInGate";
import { getCurrentISTDate } from "@/lib/dateTime";

export default function FieldVisitsPage() {
  const { currentUser } = useAuth();
  
  const [loading, setLoading] = useState(true);
  const [visits, setVisits] = useState<LocalFieldVisit[]>([]);
  const [leadsMap, setLeadsMap] = useState<Map<string, LocalLead>>(new Map());

  const loadData = async () => {
    try {
      if (!currentUser) return;
      
      const fetchedVisits = await db.field_visits.where("user_id").equals(currentUser.user_id).toArray();
      fetchedVisits.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      
      const allLeads = await db.leads.toArray();
      const lMap = new Map<string, LocalLead>();
      allLeads.forEach(l => lMap.set(l.lead_id, l));
      
      setLeadsMap(lMap);
      setVisits(fetchedVisits);
    } catch (err) {
      console.error("Failed to load visits:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [currentUser]);

  const getLeadDisplay = (lead_id: string) => {
    const lead = leadsMap.get(lead_id);
    if (lead) {
      if (lead.business_name.includes("(@")) return lead.business_name;
      return `${lead.business_name} - ${lead.phone || "N/A"}`;
    }
    return lead_id;
  };

  const todayStr = getCurrentISTDate();
  const visitsToday = visits.filter((v) => v.visit_date === todayStr).length;

  return (
    <CheckInGate>
      <div className="app-page">
        <PageHeader
          eyebrow="Field Operations"
          icon={<MapPin size={18} />}
          title="Field Visits"
          description="Log and track your physical store visits and field operations."
          actions={
            <Link href="/visits/new">
              <Button size="sm" icon={<Plus size={14} />}>
                Log new visit
              </Button>
            </Link>
          }
        />

        <div className="metric-grid">
          <MetricCard label="Visits today" value={visitsToday} icon={<MapPin size={17} />} note="Recorded in the current calendar day" />
          <MetricCard label="Total visits" value={visits.length} icon={<CheckCircle2 size={17} />} tone="neutral" note="All locally available visit records" />
        </div>

        <div className="workspace-split">
          <QueueList
            title="Recent field visits"
            items={visits.map((visit) => {
              const statusVariant = 
                visit.sync_status === "synced" ? "success" : 
                visit.sync_status === "sync_failed" ? "danger" : 
                "warning";
                
              const statusText = 
                visit.sync_status === "synced" ? "Synced" :
                visit.sync_status === "sync_failed" ? "Sync Failed" :
                "Pending Sync";

              return {
                id: visit.visit_id,
                primaryNode: (
                  <div>
                    <p className="text-[13px] font-semibold leading-snug text-[var(--text-primary)]">
                      {getLeadDisplay(visit.lead_id)}
                      {visit.segment_type && <span className="ml-2 text-xs font-normal text-[var(--text-secondary)]">({visit.segment_type})</span>}
                    </p>
                    <div className="flex gap-2 text-xs text-[var(--text-secondary)] mt-1">
                      <span className="font-medium bg-[var(--surface-secondary)] px-2 py-0.5 rounded border border-[var(--border-subtle)]">{visit.visit_outcome}</span>
                      {visit.person_met && <span>Met: {visit.person_met}</span>}
                    </div>
                    {visit.visit_notes && <p className="mt-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-primary)] p-2.5 text-[12px] leading-5 text-[var(--text-secondary)]">{visit.visit_notes}</p>}
                    {visit.check_in_photo_url && (
                       <a href={visit.check_in_photo_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs text-brand-600 hover:underline">
                         View Photo
                       </a>
                    )}
                  </div>
                ),
                statusText: statusText,
                statusVariant: statusVariant,
                timestamp: new Date(visit.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
              };
            })}
            emptyMessage={loading ? "Loading visits…" : "No visits have been recorded yet."}
            onRefresh={loadData}
          />
        </div>
      </div>
    </CheckInGate>
  );
}
