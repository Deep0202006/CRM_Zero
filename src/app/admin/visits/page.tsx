"use client";

import { useCallback, useEffect, useState } from "react";
import { Calendar, Download, MapPin, User } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import type { LocalFieldVisit } from "@/lib/db";
import { getCurrentISTDate } from "@/lib/dateTime";
import { supabase } from "@/lib/supabaseClient";
import { PageHeader } from "@/components/ui/PageHeader";
import { QueueList } from "@/components/QueueList";
import { MetricCard } from "@/components/ui/MetricCard";
import { Button } from "@/components/ui/Button";

interface AdminVisit extends LocalFieldVisit {
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
  const [total, setTotal] = useState(0);
  const [date, setDate] = useState(getCurrentISTDate());
  const [search, setSearch] = useState("");
  const [representative, setRepresentative] = useState("ALL");
  const [segment, setSegment] = useState("ALL");
  const [outcome, setOutcome] = useState("ALL");
  const [representatives, setRepresentatives] = useState<Array<{ user_id: string; name: string; email: string; is_active: boolean; capabilities: string[]; historical_only: boolean }>>([]);

  const loadData = useCallback(async (targetPage = 1) => {
    if (!isAdmin) return;
    setLoading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Authentication required");
      const params = new URLSearchParams({ page: String(targetPage), date });
      if (search.trim()) params.set("search", search.trim());
      if (representative !== "ALL") params.set("representative", representative);
      if (segment !== "ALL") params.set("segment", segment);
      if (outcome !== "ALL") params.set("outcome", outcome);
      const response = await fetch(`/api/admin/visits?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Unable to load field visits");
      const result = await response.json();
      setVisits(result.visits ?? []);
      setPage(result.page ?? targetPage);
      setHasMore(Boolean(result.has_more));
      setTotal(result.total ?? 0);
      setRepresentatives(result.representatives ?? []);
    } catch (error) {
      console.error("Failed to load admin visits:", error);
      setVisits([]);
      setHasMore(false);
      setTotal(0);
    } finally {
      setLoading(false);
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
      const params = new URLSearchParams({ dateFrom: date, dateTo: date });
      if (representative !== "ALL") params.set("agent", representative);
      if (outcome !== "ALL") params.set("outcome", outcome);
      const response = await fetch(`/api/admin/export-visits?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Export failed");
      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = `FieldVisitsExport_${date}.xlsx`;
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
        <MetricCard label="Matching visits" value={total} icon={<MapPin size={17} />} />
        <MetricCard label="Loaded page" value={visits.length} icon={<Calendar size={17} />} tone="success" />
        <MetricCard label="Representatives shown" value={new Set(visits.map((visit) => visit.user_id)).size} icon={<User size={17} />} tone="brand" />
      </div>
      <div className="mb-6 grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <input aria-label="Search visits" className="field-control min-w-0" placeholder="Business, rep, phone, notes…" value={search} onChange={(event) => setSearch(event.target.value)} />
        <input aria-label="Visit date" type="date" className="field-control min-w-0" value={date} onChange={(event) => setDate(event.target.value)} />
        <select aria-label="Representative" className="field-control min-w-0" value={representative} onChange={(event) => setRepresentative(event.target.value)}>
          <option value="ALL">All representatives</option>
          {representatives.map((user) => <option key={user.user_id} value={user.user_id}>{user.name}{user.email ? ` (${user.email})` : ""}{user.is_active ? "" : " — inactive"}</option>)}
        </select>
        <select aria-label="Segment" className="field-control min-w-0" value={segment} onChange={(event) => setSegment(event.target.value)}>
          <option value="ALL">All segments</option><option value="Retailer">Retailer</option><option value="Distributor">Distributor</option>
        </select>
        <select aria-label="Outcome" className="field-control min-w-0" value={outcome} onChange={(event) => setOutcome(event.target.value)}>
          <option value="ALL">All outcomes</option>
          {["registered", "installed", "interested", "follow_up", "not_interested"].map((value) => <option key={value} value={value}>{value.replace("_", " ")}</option>)}
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
              {visit.visit_notes && <p className="mt-2 break-words text-[12px] leading-5 text-[var(--text-secondary)]">{visit.visit_notes}</p>}
            </div>
          ),
          statusText: visit.visit_outcome,
          statusVariant: "brand",
          timestamp: new Date(visit.check_in_time).toLocaleString(),
          actions: visit.selfie_storage_path ? <EvidenceButton visitId={visit.visit_id} /> : undefined,
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
