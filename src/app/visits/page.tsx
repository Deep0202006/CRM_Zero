"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, MapPin, Plus, RotateCw } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { db, type LocalFieldVisit, type LocalLead } from "@/lib/db";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import { mergeOwnVisits } from "@/lib/fieldVisits/merge";
import { syncFieldVisits } from "@/lib/fieldVisits/sync";
import { getCurrentISTDate } from "@/lib/dateTime";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { QueueList } from "@/components/QueueList";
import { MetricCard } from "@/components/ui/MetricCard";
import { CheckInGate } from "@/components/CheckInGate";

const REMOTE_PAGE_SIZE = 50;

export default function FieldVisitsPage() {
  const { currentUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [visits, setVisits] = useState<LocalFieldVisit[]>([]);
  const [remoteVisits, setRemoteVisits] = useState<LocalFieldVisit[]>([]);
  const [leadsMap, setLeadsMap] = useState<Map<string, LocalLead>>(new Map());
  const [remotePage, setRemotePage] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  const loadLocal = useCallback(async () => {
    if (!currentUser) return [];
    const ownVisits = await db.field_visits
      .where("user_id")
      .equals(currentUser.user_id)
      .toArray();
    const referencedLeadIds = new Set(ownVisits.map((visit) => visit.lead_id));
    const localLeads = await db.leads.bulkGet([...referencedLeadIds]);
    setLeadsMap(new Map(localLeads.filter(Boolean).map((lead) => [lead!.lead_id, lead!])));
    return ownVisits;
  }, [currentUser]);

  const loadRemotePage = useCallback(async (page: number, append: boolean) => {
    if (!currentUser || !navigator.onLine || !isSupabaseConfigured) return [] as LocalFieldVisit[];
    const from = page * REMOTE_PAGE_SIZE;
    const to = from + REMOTE_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("field_visits")
      .select("*")
      .eq("user_id", currentUser.user_id)
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) throw error;
    const pageRows = (data ?? []) as LocalFieldVisit[];
    setRemoteVisits((existing) => append ? [...existing, ...pageRows] : pageRows);
    setRemotePage(page);
    setHasMore(pageRows.length === REMOTE_PAGE_SIZE);
    return pageRows;
  }, [currentUser]);

  const loadData = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const ownLocal = await loadLocal();
      let confirmedRemote: LocalFieldVisit[] = [];
      if (navigator.onLine && isSupabaseConfigured) {
        confirmedRemote = await loadRemotePage(0, false);
      }
      setVisits(mergeOwnVisits(currentUser.user_id, ownLocal, confirmedRemote));
    } catch (error) {
      console.error("Failed to load visits:", error);
      const ownLocal = await loadLocal();
      setVisits(mergeOwnVisits(currentUser.user_id, ownLocal, []));
    } finally {
      setLoading(false);
    }
  }, [currentUser, loadLocal, loadRemotePage]);

  useEffect(() => {
    queueMicrotask(() => void loadData());
  }, [loadData]);

  const loadMore = async () => {
    if (!currentUser) return;
    const nextRows = await loadRemotePage(remotePage + 1, true);
    const ownLocal = await loadLocal();
    setVisits(mergeOwnVisits(currentUser.user_id, ownLocal, [...remoteVisits, ...nextRows]));
  };

  const retryVisit = async (visitId: string) => {
    await syncFieldVisits(visitId);
    await loadData();
  };

  const getLeadDisplay = (leadId: string) => {
    const lead = leadsMap.get(leadId);
    return lead ? `${lead.business_name} - ${lead.phone || "N/A"}` : `Unavailable business (${leadId.slice(0, 8)})`;
  };

  const today = getCurrentISTDate();
  return (
    <CheckInGate>
      <div className="app-page min-w-0">
        <PageHeader
          eyebrow="Field Operations"
          icon={<MapPin size={18} />}
          title="My Visits"
          description="Log and track your own retailer and distributor visits."
          actions={<Link href="/visits/new"><Button size="sm" icon={<Plus size={14} />}>Log new visit</Button></Link>}
        />
        <div className="metric-grid">
          <MetricCard label="Visits today" value={visits.filter((visit) => visit.visit_date === today).length} icon={<MapPin size={17} />} note="Your visits today" />
          <MetricCard label="Loaded visits" value={visits.length} icon={<CheckCircle2 size={17} />} tone="neutral" note="Local work plus bounded remote history" />
        </div>
        <QueueList
          title="My field visits"
          items={visits.map((visit) => {
            const status = visit.sync_status === "synced"
              ? { text: "Synced", variant: "success" as const }
              : visit.sync_status === "sync_failed"
                ? { text: navigator.onLine ? "Retrying" : "Needs attention", variant: "danger" as const }
                : { text: "Waiting to sync", variant: "warning" as const };
            return {
              id: visit.visit_id,
              primaryNode: (
                <div className="min-w-0">
                  <p className="whitespace-normal break-words text-[13px] font-semibold leading-snug text-[var(--text-primary)]">
                    {getLeadDisplay(visit.lead_id)}
                    {visit.segment_type && <span className="ml-2 whitespace-normal break-words text-xs font-normal text-[var(--text-secondary)]">({visit.segment_type})</span>}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-[var(--text-secondary)]">
                    <span className="break-words rounded border border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-2 py-0.5 font-medium">{visit.visit_outcome}</span>
                    {visit.person_met && <span className="break-words">Met: {visit.person_met}</span>}
                  </div>
                  {visit.visit_notes && <p className="mt-2 whitespace-normal break-words rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-primary)] p-2.5 text-[12px] leading-5 text-[var(--text-secondary)]">{visit.visit_notes}</p>}
                </div>
              ),
              statusText: status.text,
              statusVariant: status.variant,
              timestamp: new Date(visit.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
              actions: visit.sync_status === "sync_failed"
                ? <Button size="sm" variant="outline" icon={<RotateCw size={13} />} onClick={() => void retryVisit(visit.visit_id)}>Retry</Button>
                : undefined,
            };
          })}
          emptyMessage={loading ? "Loading visits…" : "No visits have been recorded yet."}
          onRefresh={() => void loadData()}
        />
        {hasMore && (
          <div className="mt-4 flex justify-center">
            <Button variant="outline" onClick={() => void loadMore()}>Load More</Button>
          </div>
        )}
      </div>
    </CheckInGate>
  );
}
