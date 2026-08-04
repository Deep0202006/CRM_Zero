"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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

interface AdminVisit extends LocalFieldVisit {
  has_selfie_evidence?: boolean;
  confirmation_status?: "Confirmed" | "Evidence pending";
  users?: { name?: string | null; email?: string | null } | null;
  leads?: { business_name?: string | null; contact_person?: string | null; phone?: string | null } | null;
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
  const [legacyMismatchCount, setLegacyMismatchCount] = useState(0);
  const [date, setDate] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [search, setSearch] = useState("");
  const [representative, setRepresentative] = useState("ALL");
  const [segment, setSegment] = useState("ALL");
  const [outcome, setOutcome] = useState("ALL");
  const [representatives, setRepresentatives] = useState<Array<{ user_id: string; name: string; email: string; is_active: boolean; capabilities: string[]; historical_only: boolean }>>([]);
  const requestSequence = useRef(0);

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
      setRepresentatives(result.representatives ?? []);
      setLegacyMismatchCount(result.legacy_date_mismatch_count ?? 0);
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      console.error("Failed to load admin visits:", error);
      setErrorMessage(error instanceof Error ? error.message : "Unable to load field visits");
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [date, isAdmin, outcome, representative, search, segment]);

  useEffect(() => {
    queueMicrotask(() => void loadData(1));
  }, [loadData]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Authentication required");
      const params = new URLSearchParams();
      if (date) params.set("date", date);
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
        eyebrow="Field Operations"
        icon={<MapPin size={18} />}
        title="Team Field Visits"
        description="Confirmed field visits from the original production source."
        actions={<Button size="sm" variant="outline" icon={<Download size={14} />} onClick={handleExport} isLoading={exporting}>Export to Excel</Button>}
      />
      <div className="metric-grid">
        <MetricCard label="Total visits" value={allTimeTotal} icon={<MapPin size={17} />} />
        <MetricCard label="Visits today" value={todayTotal} icon={<Calendar size={17} />} tone="success" />
        <MetricCard label="Representatives" value={representatives.length} icon={<User size={17} />} tone="brand" />
        <MetricCard label="Loaded rows" value={visits.length} icon={<CheckCircle2 size={17} />} />
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        <Button size="sm" variant={date ? "outline" : "primary"} onClick={() => { setPage(1); setDate(""); }}>All visits</Button>
        <Button size="sm" variant={date === getCurrentISTDate() ? "primary" : "outline"} onClick={() => { setPage(1); setDate(getCurrentISTDate()); }}>Today</Button>
      </div>
      {legacyMismatchCount > 0 && <div role="status" className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Included {legacyMismatchCount} confirmed visit{legacyMismatchCount === 1 ? "" : "s"} whose stored date differs from the selected India check-in date.</div>}
      {errorMessage && <div role="alert" className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{errorMessage} <Button size="sm" variant="outline" onClick={() => void loadData(page)}>Refresh</Button></div>}
      <div className="mb-6 grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <input aria-label="Search visits" className="field-control min-w-0" placeholder="Business, representative, or notes" value={search} onChange={(event) => { setPage(1); setSearch(event.target.value); }} />
        <input aria-label="Visit date" type="date" className="field-control min-w-0" value={date} onChange={(event) => { setPage(1); setDate(event.target.value); }} />
        <select aria-label="Representative" className="field-control min-w-0" value={representative} onChange={(event) => { setPage(1); setRepresentative(event.target.value); }}>
          <option value="ALL">All representatives</option>
          {representatives.map((user) => <option key={user.user_id} value={user.user_id}>{user.name}{user.email ? ` (${user.email})` : ""}{user.is_active ? "" : " — inactive"}{user.historical_only ? " — historical" : ""}</option>)}
        </select>
        <select aria-label="Segment" className="field-control min-w-0" value={segment} onChange={(event) => { setPage(1); setSegment(event.target.value); }}>
          <option value="ALL">All segments</option><option value="Retailer">Retailer</option><option value="Distributor">Distributor</option>
        </select>
        <select aria-label="Outcome" className="field-control min-w-0" value={outcome} onChange={(event) => { setPage(1); setOutcome(event.target.value); }}>
          <option value="ALL">All outcomes</option>
          {["registered", "installed", "interested", "follow_up", "payment_follow_up", "not_interested"].map((value) => <option key={value} value={value}>{getOutcomeLabel(value)}</option>)}
        </select>
      </div>
      <QueueList
        title="Confirmed visit history"
        items={visits.map((visit) => ({
          id: visit.visit_id,
          primaryNode: (
            <div className="min-w-0 whitespace-normal break-words">
              <p className="break-words text-[13px] font-semibold leading-snug text-[var(--text-primary)]">{visit.leads?.business_name || "Unavailable business"} <span className="font-normal text-[var(--text-secondary)]">({visit.segment_type})</span></p>
              <p className="mt-1 break-all text-[11px] leading-5 text-[var(--text-muted)]">Rep · {visit.users?.name || "Unknown"} · {visit.users?.email || "Unavailable"}</p>
              <p className="mt-1 text-[12px] text-[var(--text-secondary)]">Person met: {visit.person_met || "Unavailable"} · Outcome: {getOutcomeLabel(visit.visit_outcome)}{visit.follow_up_date ? ` · Follow-up: ${visit.follow_up_date}` : ""} · Synchronization confirmed</p>
              {visit.visit_notes && <p className="mt-2 break-words text-[12px] leading-5 text-[var(--text-secondary)]">{visit.visit_notes}</p>}
            </div>
          ),
          statusText: visit.confirmation_status ?? (visit.has_selfie_evidence ? "Confirmed" : "Evidence pending"),
          statusVariant: visit.has_selfie_evidence ? "success" : "warning",
          timestamp: new Date(visit.check_in_time).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" }),
          actions: visit.has_selfie_evidence ? <EvidenceButton visitId={visit.visit_id} /> : undefined,
        }))}
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
