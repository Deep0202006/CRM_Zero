"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Calendar, CheckCircle2, Download, MapPin, User } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import type { LocalFieldVisit } from "@/lib/db";
import { getCurrentISTDate } from "@/lib/dateTime";
import { supabase } from "@/lib/supabaseClient";
import { PageHeader } from "@/components/ui/PageHeader";
import { QueueList } from "@/components/QueueList";
import { MetricCard } from "@/components/ui/MetricCard";
import { Button } from "@/components/ui/Button";
import { getOutcomeLabel } from "@/lib/fieldVisits/contract";
import { AnalyticsSkeleton } from "@/components/analytics/AnalyticsPanel";
import { NumberTicker } from "@/components/analytics/NumberTicker";
import { buildVisitAnalytics } from "@/lib/analytics/viewModels";

const VisitsIntelligence = dynamic(() => import("@/components/analytics/VisitsIntelligence"), {
  ssr: false,
  loading: () => <AnalyticsSkeleton label="Loading field activity intelligence" />,
});

interface AdminVisit extends LocalFieldVisit {
  has_selfie_evidence?: boolean;
  selfie_status?: "AVAILABLE" | "PURGED" | "PENDING";
  confirmation_status?: string;
  users?: { name?: string | null; email?: string | null } | null;
  leads?: { business_name?: string | null; contact_person?: string | null; phone?: string | null } | null;
}

function getAdminOutcomeLabel(outcome: string): string {
  const label = getOutcomeLabel(outcome);
  return outcome === "registered" ? "New Registration" : label;
}

function getAdminOutcomeVariant(outcome: string): "success" | "brand" | "info" | "warning" | "danger" {
  switch (outcome) {
    case "registered": return "brand";
    case "installed": return "success";
    case "payment_done": return "success";
    case "interested": return "info";
    case "follow_up":
    case "payment_follow_up": return "warning";
    case "not_interested": return "danger";
    default: return "brand";
  }
}

export default function AdminVisitsPage() {
  const { isAdmin } = useAuth();
  const [visits, setVisits] = useState<AdminVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [allTimeTotal, setAllTimeTotal] = useState(0);
  const [todayTotal, setTodayTotal] = useState(0);
  const [matchedTotal, setMatchedTotal] = useState(0);
  const [legacyMismatchCount, setLegacyMismatchCount] = useState(0);
  const [date, setDate] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [search, setSearch] = useState("");
  const [representative, setRepresentative] = useState("ALL");
  const [segment, setSegment] = useState("ALL");
  const [outcome, setOutcome] = useState("ALL");
  const [representatives, setRepresentatives] = useState<Array<{ user_id: string; name: string; email: string; is_active: boolean; capabilities: string[]; historical_only: boolean }>>([]);
  const requestSequence = useRef(0);
  const realtimeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [realtimeSubscribed, setRealtimeSubscribed] = useState(false);

  const loadData = useCallback(async (targetPage = 1) => {
    if (!isAdmin) return;
    const sequence = ++requestSequence.current;
    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Authentication required");
      setErrorMessage("");
      const params = new URLSearchParams({ page: String(targetPage) });
      if (date) params.set("date", date);
      if (!date && dateFrom) params.set("date_from", dateFrom);
      if (!date && dateTo) params.set("date_to", dateTo);
      if (search.trim()) params.set("search", search.trim());
      if (representative !== "ALL") params.set("representative", representative);
      if (segment !== "ALL") params.set("segment", segment);
      if (outcome !== "ALL") params.set("outcome", outcome);
      const response = await fetch(`/api/admin/visits?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Unable to load field visits");
      if (sequence !== requestSequence.current) return;
      setVisits(result.visits ?? []);
      setPage(result.page ?? targetPage);
      setHasMore(Boolean(result.has_more));
      setAllTimeTotal(result.all_time_total ?? 0);
      setTodayTotal(result.today_total ?? 0);
      setMatchedTotal(result.total ?? 0);
      setRepresentatives(result.representatives ?? []);
      setLegacyMismatchCount(result.legacy_date_mismatch_count ?? 0);
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      console.error("Failed to load admin visits:", error);
      setErrorMessage(error instanceof Error ? error.message : "Unable to load field visits");
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [date, dateFrom, dateTo, isAdmin, outcome, representative, search, segment]);

  const visitAnalytics = useMemo(() => buildVisitAnalytics(visits), [visits]);

  useEffect(() => {
    queueMicrotask(() => void loadData(1));
  }, [loadData]);

  useEffect(() => {
    if (!isAdmin) return;
    const scheduleRefresh = () => {
      if (realtimeTimer.current) clearTimeout(realtimeTimer.current);
      realtimeTimer.current = setTimeout(() => void loadData(page), 350);
    };
    const channel = supabase.channel("admin-field-visits-authoritative")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "field_visits" }, scheduleRefresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "field_visits" }, scheduleRefresh)
      .subscribe((status) => setRealtimeSubscribed(status === "SUBSCRIBED"));
    return () => {
      if (realtimeTimer.current) clearTimeout(realtimeTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [isAdmin, loadData, page]);

  useEffect(() => {
    const updateFallback = () => {
      if (!realtimeSubscribed && document.visibilityState === "visible") void loadData(page);
    };
    document.addEventListener("visibilitychange", updateFallback);
    return () => { document.removeEventListener("visibilitychange", updateFallback); };
  }, [loadData, page, realtimeSubscribed]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Authentication required");
      const params = new URLSearchParams();
      if (date) params.set("date", date);
      if (!date && dateFrom) params.set("date_from", dateFrom);
      if (!date && dateTo) params.set("date_to", dateTo);
      if (search.trim()) params.set("search", search.trim());
      if (representative !== "ALL") params.set("agent", representative);
      if (segment !== "ALL") params.set("segment", segment);
      if (outcome !== "ALL") params.set("outcome", outcome);
      const response = await fetch(`/api/admin/export-visits?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Export failed");
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = `FieldVisitsExport_${date || "all"}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error("Export error:", error);
    } finally {
      setExporting(false);
    }
  };

  if (!isAdmin) {
    return <div className="app-page"><PageHeader eyebrow="Security" title="Access Denied" description="You do not have permission to view this page." /></div>;
  }

  return (
    <div className="app-page min-w-0">
      <PageHeader
        eyebrow="Field Activity Intelligence"
        icon={<MapPin size={18} />}
        title="VISITS OVERVIEW"
        description="Bounded authoritative history. Selfies load only on explicit request."
        actions={<Button size="sm" variant="outline" icon={<Download size={14} />} onClick={handleExport} isLoading={exporting}>Export to Excel</Button>}
      />
      <div className="metric-grid">
        <MetricCard label="Total visits" value={<NumberTicker value={allTimeTotal} />} icon={<MapPin size={17} />} />
        <MetricCard label="Visits today" value={<NumberTicker value={todayTotal} />} icon={<Calendar size={17} />} tone="success" />
        <MetricCard label="Representatives" value={<NumberTicker value={representatives.length} />} icon={<User size={17} />} tone="brand" />
        <MetricCard label="Loaded rows" value={<NumberTicker value={visits.length} />} icon={<CheckCircle2 size={17} />} />
      </div>
      {loading ? <AnalyticsSkeleton label="Loading field activity intelligence" /> : !errorMessage ? <VisitsIntelligence model={visitAnalytics} matchedTotal={matchedTotal} page={page} /> : null}
      <div className="mb-3 flex flex-wrap gap-2">
        <Button size="sm" variant={date ? "outline" : "primary"} onClick={() => { setPage(1); setDate(""); }}>All visits</Button>
        <Button size="sm" variant={date === getCurrentISTDate() ? "primary" : "outline"} onClick={() => { setPage(1); setDate(getCurrentISTDate()); }}>Today</Button>
        <Button size="sm" variant={segment === "Retailer" ? "primary" : "outline"} onClick={() => { setPage(1); setSegment(segment === "Retailer" ? "ALL" : "Retailer"); }}>Retailer</Button>
        <Button size="sm" variant={segment === "Distributor" ? "primary" : "outline"} onClick={() => { setPage(1); setSegment(segment === "Distributor" ? "ALL" : "Distributor"); }}>Distributor</Button>
      </div>
      {legacyMismatchCount > 0 && <div role="status" className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Included {legacyMismatchCount} confirmed visit{legacyMismatchCount === 1 ? "" : "s"} whose stored date differs from the selected India check-in date.</div>}
      {errorMessage && <div role="alert" className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{errorMessage} <Button size="sm" variant="outline" onClick={() => void loadData(page)}>Refresh</Button></div>}
      <div className="mb-6 grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <input aria-label="Search visits" className="field-control min-w-0" placeholder="Business, representative, or notes" value={search} onChange={(event) => { setPage(1); setSearch(event.target.value); }} />
        <input aria-label="Visit date" type="date" className="field-control min-w-0" value={date} onChange={(event) => { setPage(1); setDate(event.target.value); }} />
        <input aria-label="Date From" type="date" className="field-control min-w-0" value={dateFrom} onChange={(event) => { setPage(1); setDate(""); setDateFrom(event.target.value); }} />
        <input aria-label="Date To" type="date" className="field-control min-w-0" value={dateTo} onChange={(event) => { setPage(1); setDate(""); setDateTo(event.target.value); }} />
        <select aria-label="Representative" className="field-control min-w-0" value={representative} onChange={(event) => { setPage(1); setRepresentative(event.target.value); }}>
          <option value="ALL">All representatives</option>
          {representatives.map((user) => <option key={user.user_id} value={user.user_id}>{user.name}{user.email ? ` (${user.email})` : ""}{user.is_active ? "" : " — inactive"}{user.historical_only ? " — historical" : ""}</option>)}
        </select>
        <select aria-label="Segment" className="field-control min-w-0" value={segment} onChange={(event) => { setPage(1); setSegment(event.target.value); }}>
          <option value="ALL">All segments</option><option value="Retailer">Retailer</option><option value="Distributor">Distributor</option>
        </select>
        <select aria-label="Outcome" className="field-control min-w-0" value={outcome} onChange={(event) => { setPage(1); setOutcome(event.target.value); }}>
          <option value="ALL">All outcomes</option>
          {["registered", "installed", "interested", "follow_up", "payment_follow_up", "payment_done", "not_interested"].map((value) => <option key={value} value={value}>{getOutcomeLabel(value)}</option>)}
        </select>
      </div>
      <QueueList
        title="Confirmed visit history"
        items={visits.map((visit) => {
          const confirmationText = visit.selfie_status === "PURGED" ? "Selfie captured · Expired after 5-day retention" : visit.selfie_status === "AVAILABLE" ? "Selfie available" : "Evidence pending";
          return {
            id: visit.visit_id,
            primaryNode: (
              <div className="min-w-0 whitespace-normal break-words">
                <p className="break-words text-[13px] font-semibold leading-snug text-[var(--text-primary)]">{visit.leads?.business_name?.trim() || visit.lead_id?.trim() || "Unavailable business"} <span className="font-normal text-[var(--text-secondary)]">({visit.segment_type})</span></p>
                <p className="mt-1 break-all text-[11px] leading-5 text-[var(--text-muted)]">Rep · {visit.users?.name || "Unknown"} · {visit.users?.email || "Unavailable"}</p>
                <p className="mt-1 text-[12px] text-[var(--text-secondary)]">Person met: {visit.person_met || "Unavailable"}{visit.follow_up_date ? ` · Follow-up: ${visit.follow_up_date}` : ""} · {confirmationText}</p>
                <p className="mt-2 whitespace-pre-wrap break-words text-[13px] font-medium leading-5 text-[var(--text-primary)]">{visit.address?.trim() || "Legacy visit — address was not captured"}</p>
                <details className="mt-2 rounded border border-[var(--border-subtle)] p-3 text-[12px] leading-5 text-[var(--text-secondary)]"><summary className="cursor-pointer font-semibold">Visit detail</summary><p><strong>GPS:</strong> {visit.check_in_lat != null && visit.check_in_lng != null ? `${visit.check_in_lat}, ${visit.check_in_lng}` : "Not captured"}</p><p><strong>Sync:</strong> {visit.sync_status || "Confirmed"}</p><p><strong>Follow-up:</strong> {visit.follow_up_date || "None"}</p><p className="whitespace-pre-wrap"><strong>Notes:</strong> {visit.visit_notes || "None"}</p>{visit.check_in_lat != null && visit.check_in_lng != null && <a target="_blank" rel="noreferrer" className="text-[var(--brand-700)] underline" href={`https://www.google.com/maps?q=${visit.check_in_lat},${visit.check_in_lng}`}>Open Location</a>}</details>
              </div>
            ),
            statusText: getAdminOutcomeLabel(visit.visit_outcome),
            statusVariant: getAdminOutcomeVariant(visit.visit_outcome),
            timestamp: new Date(visit.check_in_time).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }),
            actions: visit.selfie_status === "AVAILABLE" ? <EvidenceButton visitId={visit.visit_id} /> : visit.selfie_status === "PURGED" ? <span className="text-xs text-[var(--text-muted)]">Selfie expired after 5-day retention</span> : undefined,
          };
        })}
        emptyMessage={loading ? "Loading visits…" : "No confirmed visits match these filters."}
        onRefresh={() => void loadData(page)}
      />
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Button variant="outline" disabled={page <= 1 || loading} onClick={() => void loadData(page - 1)}>Previous</Button>
        <Button variant="outline" disabled={!hasMore || loading} onClick={() => void loadData(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

function EvidenceButton({ visitId }: { visitId: string }) {
  const [loading, setLoading] = useState(false);
  const openEvidence = async () => {
    setLoading(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) return;
      const response = await fetch(`/api/admin/visits/evidence?visit_id=${encodeURIComponent(visitId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return;
      const result = await response.json();
      window.open(result.url, "_blank", "noopener,noreferrer");
    } finally {
      setLoading(false);
    }
  };
  return <Button size="sm" variant="outline" isLoading={loading} onClick={openEvidence}>View Selfie</Button>;
}
