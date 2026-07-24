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

  const [searchTerm, setSearchTerm] = useState("");
  const [filterOutcome, setFilterOutcome] = useState("ALL");
  const [filterAgent, setFilterAgent] = useState("ALL");

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
  const activeAgents = Array.from(uniqueUsers ? new Set(visits.map(v => v.user_id)) : []).map(id => ({ id, name: getAgentDisplay(id) }));

  const filteredVisits = visits.filter((v) => {
    if (filterOutcome !== "ALL" && v.visit_outcome !== filterOutcome) return false;
    if (filterAgent !== "ALL" && v.user_id !== filterAgent) return false;
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      const leadName = getLeadDisplay(v.lead_id).toLowerCase();
      const agentName = getAgentDisplay(v.user_id).toLowerCase();
      if (!leadName.includes(q) && !agentName.includes(q) && !(v.visit_notes || "").toLowerCase().includes(q)) {
        return false;
      }
    }
    return true;
  });

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

      <div className="mb-6 flex flex-wrap gap-4 items-center">
         <input 
           type="text" 
           placeholder="Search business, agent, or notes..." 
           className="field-control max-w-sm" 
           value={searchTerm} 
           onChange={(e) => setSearchTerm(e.target.value)} 
         />
         <select className="field-control max-w-xs" value={filterOutcome} onChange={(e) => setFilterOutcome(e.target.value)}>
           <option value="ALL">All Outcomes</option>
           <option value="Successful Pitch">Successful Pitch</option>
           <option value="Follow-up Required">Follow-up Required</option>
           <option value="Not Interested">Not Interested</option>
           <option value="Store Closed">Store Closed</option>
           <option value="Other">Other</option>
         </select>
         <select className="field-control max-w-xs" value={filterAgent} onChange={(e) => setFilterAgent(e.target.value)}>
           <option value="ALL">All Agents</option>
           {activeAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
         </select>
      </div>

      <div className="workspace-split">
        <QueueList
          title="Field Visit History"
          items={filteredVisits.map((visit) => ({
            id: visit.visit_id,
            primaryNode: (
              <div>
                <p className="text-[13px] font-semibold leading-snug text-[var(--text-primary)]">
                  {getLeadDisplay(visit.lead_id)}
                  {visit.segment_type && <span className="ml-2 text-xs font-normal text-[var(--text-secondary)]">({visit.segment_type})</span>}
                </p>
                <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
                  Rep · <span className="normal-case tracking-normal text-[var(--text-secondary)]">{getAgentDisplay(visit.user_id)}</span>
                </p>
                <div className="flex gap-2 text-xs text-[var(--text-secondary)] mt-2">
                  <span className="font-medium bg-[var(--surface-secondary)] px-2 py-0.5 rounded border border-[var(--border-subtle)]">{visit.visit_outcome}</span>
                  {visit.person_met && <span>Met: {visit.person_met}</span>}
                </div>
                <div className="mt-2 text-[11px] text-[var(--text-secondary)] flex gap-4">
                  <span>Coordinates: {visit.check_in_lat ? `${visit.check_in_lat.toFixed(5)}, ${visit.check_in_lng?.toFixed(5)}` : "None"}</span>
                  {visit.check_in_photo_url && (
                    <PhotoViewerLink rawUrl={visit.check_in_photo_url} />
                  )}
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

function PhotoViewerLink({ rawUrl }: { rawUrl: string }) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  
  useEffect(() => {
    async function load() {
      // Extract file path from publicUrl format
      // https://[ref].supabase.co/storage/v1/object/public/visits-evidence/uuid/file.jpg -> uuid/file.jpg
      const match = rawUrl.match(/visits-evidence\/(.+)$/);
      const filePath = match ? match[1] : rawUrl;
      
      const { supabase } = await import('@/lib/supabaseClient');
      const { data } = await supabase.storage.from("visits-evidence").createSignedUrl(filePath, 3600);
      if (data?.signedUrl) {
        setSignedUrl(data.signedUrl);
      } else {
        setSignedUrl(rawUrl); // fallback
      }
    }
    load();
  }, [rawUrl]);

  return (
    <a 
      href={signedUrl || "#"} 
      target={signedUrl ? "_blank" : undefined} 
      rel="noreferrer" 
      className={`text-brand-600 hover:underline ${!signedUrl ? "opacity-50 cursor-not-allowed" : ""}`}
      onClick={(e) => { if (!signedUrl) e.preventDefault(); }}
    >
      View Photo
    </a>
  );
}
