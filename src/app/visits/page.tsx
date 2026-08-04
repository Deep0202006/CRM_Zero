"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, MapPin, Plus, RotateCw } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { db, processSyncQueue, type LocalFieldVisit, type LocalLead } from "@/lib/db";
import { supabase, isSupabaseConfigured } from "@/lib/supabaseClient";
import { mergeOwnVisits } from "@/lib/fieldVisits/merge";
import { calculateOwnVisitMetrics, type OwnVisitMetrics } from "@/lib/fieldVisits/metrics";
import { syncFieldVisits } from "@/lib/fieldVisits/sync";
import { getCurrentISTDate } from "@/lib/dateTime";
import { getOutcomeLabel } from "@/lib/fieldVisits/contract";
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
  const [retryingVisitId, setRetryingVisitId] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<OwnVisitMetrics>({ totalVisits: 0, visitsToday: 0, waitingToSync: 0 });
  const [metricsError, setMetricsError] = useState("");
  const [recoveryResult, setRecoveryResult] = useState("");

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
      let reconciledLocal = ownLocal;
      let confirmedRemote: LocalFieldVisit[] = [];
      if (navigator.onLine && isSupabaseConfigured) {
        const today = getCurrentISTDate();
        const retryable = ownLocal.filter((visit) => visit.sync_status === "pending_sync" || visit.sync_status === "sync_failed" || visit.sync_stage === "pending_visit" || visit.sync_stage === "sync_failed" || visit.sync_stage === "visit_confirmed_evidence_pending");
        const localIds = [...new Set(retryable.map((visit) => visit.visit_id))];
        confirmedRemote = await loadRemotePage(0, false);
        const [totalResult, todayResult, reconciliationResult] = await Promise.all([
          supabase.from("field_visits").select("visit_id", { count: "exact", head: true }).eq("user_id", currentUser.user_id),
          supabase.from("field_visits").select("visit_id", { count: "exact", head: true }).eq("user_id", currentUser.user_id).eq("visit_date", today),
          localIds.length
            ? supabase.from("field_visits").select("visit_id").eq("user_id", currentUser.user_id).in("visit_id", localIds)
            : Promise.resolve({ data: [], error: null }),
        ]);
        if (totalResult.error || todayResult.error || reconciliationResult.error) {
          console.error("Failed to load authoritative visit metrics");
          setMetricsError("Authoritative visit totals are temporarily unavailable. Refresh to retry.");
        } else {
          const confirmedLocalIds = new Set((reconciliationResult.data ?? []).map((visit) => visit.visit_id));
          reconciledLocal = ownLocal.map((visit) => confirmedLocalIds.has(visit.visit_id) && visit.sync_stage !== "visit_confirmed_evidence_pending" ? { ...visit, sync_status: "synced" as const, sync_stage: "synced" as const } : visit);
          setMetrics(calculateOwnVisitMetrics(
            currentUser.user_id,
            today,
            totalResult.count ?? 0,
            todayResult.count ?? 0,
            ownLocal,
            (reconciliationResult.data ?? []).map((visit) => visit.visit_id),
          ));
          setMetricsError("");
        }
      } else {
        setMetrics(calculateOwnVisitMetrics(currentUser.user_id, getCurrentISTDate(), 0, 0, ownLocal, []));
      }
      setVisits(mergeOwnVisits(currentUser.user_id, reconciledLocal, confirmedRemote));
    } catch (error) {
      console.error("Failed to load visits:", error);
      const ownLocal = await loadLocal();
      setVisits(mergeOwnVisits(currentUser.user_id, ownLocal, []));
      setMetricsError("Authoritative visit totals are temporarily unavailable. Refresh to retry.");
    } finally {
      setLoading(false);
    }
  }, [currentUser, loadLocal, loadRemotePage]);

  useEffect(() => {
    queueMicrotask(() => void (async () => {
      if (currentUser && navigator.onLine) {
        await processSyncQueue();
        await syncFieldVisits(undefined, currentUser.user_id, "recovery");
      }
      await loadData();
    })());
  }, [currentUser, loadData]);

  const loadMore = async () => {
    if (!currentUser) return;
    const nextRows = await loadRemotePage(remotePage + 1, true);
    const ownLocal = await loadLocal();
    setVisits(mergeOwnVisits(currentUser.user_id, ownLocal, [...remoteVisits, ...nextRows]));
  };

  const retryVisit = async (visitId: string) => {
    setRetryingVisitId(visitId);
    try {
      await processSyncQueue();
      await syncFieldVisits(visitId, currentUser?.user_id, "recovery");
      await loadData();
    } finally {
      setRetryingVisitId(null);
    }
  };

  const recoverableVisits = visits.filter((visit) => visit.user_id === currentUser?.user_id && (visit.sync_status === "pending_sync" || visit.sync_status === "sync_failed" || visit.sync_stage === "pending_visit" || visit.sync_stage === "sync_failed" || visit.sync_stage === "visit_confirmed_evidence_pending"));
  const recoverUnsyncedVisits = async () => {
    setRetryingVisitId("ALL");
    try {
      await processSyncQueue();
      const result = await syncFieldVisits(undefined, currentUser?.user_id, "recovery");
      setRecoveryResult(`Locally found: ${result.locallyFound}. Remotely confirmed now: ${result.confirmed}. Already confirmed: ${result.alreadyConfirmed}. Evidence pending: ${result.evidencePending}. Attendance blocked: ${result.attendanceBlocked}. Reference-compatible recoveries: ${result.referenceCompatibleRecoveries}. Still failed: ${result.failed}.${result.failureCodes.length ? ` Safe failure codes: ${result.failureCodes.join(", ")}.` : ""}`);
      await loadData();
    } finally {
      setRetryingVisitId(null);
    }
  };

  const getLeadDisplay = (leadId: string) => {
    const lead = leadsMap.get(leadId);
    return lead ? `${lead.business_name} - ${lead.phone || "N/A"}` : `Unavailable business (${leadId.slice(0, 8)})`;
  };

  return (
    <CheckInGate>
      <div className="app-page min-w-0">
        <PageHeader
          eyebrow="Field Operations"
          icon={<MapPin size={18} />}
          title="My Visits"
          description="Log and track your own retailer and distributor visits."
          actions={<div className="flex flex-wrap gap-2">{recoverableVisits.length > 0 && <Button size="sm" variant="outline" icon={<RotateCw size={14} />} isLoading={retryingVisitId === "ALL"} onClick={() => void recoverUnsyncedVisits()}>Recover unsynced visits</Button>}<Link href="/visits/new"><Button size="sm" icon={<Plus size={14} />}>Log new visit</Button></Link></div>}
        />
        <div className="metric-grid">
          <MetricCard label="Total visits" value={metrics.totalVisits} icon={<CheckCircle2 size={17} />} note="Confirmed plus local-only work" />
          <MetricCard label="Visits today" value={metrics.visitsToday} icon={<MapPin size={17} />} note="Your visits today" />
          <MetricCard label="Waiting to sync" value={metrics.waitingToSync} icon={<RotateCw size={17} />} tone={metrics.waitingToSync ? "warning" : "neutral"} note="Pending or needs attention" />
        </div>
        {metricsError && <div role="alert" className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{metricsError}</div>}
        {recoveryResult && <div role="status" className="mb-4 rounded border border-blue-300 bg-blue-50 p-3 text-sm text-blue-900">{recoveryResult}</div>}
        <QueueList
          title="My field visits"
          items={visits.map((visit) => {
            const retryable = visit.sync_status === "pending_sync" || visit.sync_status === "sync_failed" || visit.sync_stage === "pending_visit" || visit.sync_stage === "sync_failed" || visit.sync_stage === "visit_confirmed_evidence_pending";
            const status = visit.sync_stage === "visit_confirmed_evidence_pending"
              ? { text: "Confirmed — evidence pending", variant: "warning" as const }
              : visit.sync_error_code === "BUSINESS_REFERENCE_WARNING" && (visit.sync_status === "synced" || visit.sync_stage === "synced")
                ? { text: "Business reference warning", variant: "warning" as const }
              : visit.sync_status === "synced" || visit.sync_stage === "synced"
                ? { text: "Confirmed", variant: "success" as const }
                : visit.sync_error_code === "ATTENDANCE_NOT_CONFIRMED" || visit.sync_error_code === "ATTENDANCE_INTEGRITY_ERROR"
                  ? { text: "Attendance confirmation pending", variant: "warning" as const }
                  : visit.sync_error_code === "NETWORK_UNAVAILABLE"
                    ? { text: "Saved offline", variant: "warning" as const }
                    : { text: retryingVisitId === visit.visit_id ? "Retrying" : "Needs retry", variant: "danger" as const };
            return {
              id: visit.visit_id,
              primaryNode: (
                <div className="min-w-0">
                  <p className="whitespace-normal break-words text-[13px] font-semibold leading-snug text-[var(--text-primary)]">
                    {getLeadDisplay(visit.lead_id)}
                    {visit.segment_type && <span className="ml-2 whitespace-normal break-words text-xs font-normal text-[var(--text-secondary)]">({visit.segment_type})</span>}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-[var(--text-secondary)]">
                    <span className="break-words rounded border border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-2 py-0.5 font-medium">{getOutcomeLabel(visit.visit_outcome)}</span>
                    {visit.person_met && <span className="break-words">Met: {visit.person_met}</span>}
                  </div>
                  {visit.follow_up_date && <p className="mt-1 text-[12px] text-[var(--text-secondary)]">Follow-up: {visit.follow_up_date}</p>}
                  {visit.visit_notes && <p className="mt-2 whitespace-normal break-words rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-primary)] p-2.5 text-[12px] leading-5 text-[var(--text-secondary)]">{visit.visit_notes}</p>}
                </div>
              ),
              statusText: status.text,
              statusVariant: status.variant,
              timestamp: new Date(visit.created_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
              actions: retryable
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
