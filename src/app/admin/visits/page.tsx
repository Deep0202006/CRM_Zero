"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { getCurrentISTDate } from "@/lib/dateTime";
import type { VisitReport, VisitReportRow } from "@/lib/fieldVisits/serverReport";
import { MapPin, User, Download, Calendar, AlertCircle, Image as ImageIcon } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { QueueList } from "@/components/QueueList";
import { MetricCard } from "@/components/ui/MetricCard";
import { Button } from "@/components/ui/Button";
import { supabase } from "@/lib/supabaseClient";

const PAGE_SIZE = 50;

export default function AdminVisitsPage() {
  const { allUsers, isAdmin } = useAuth();
  const today = getCurrentISTDate();
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterOutcome, setFilterOutcome] = useState("ALL");
  const [filterAgent, setFilterAgent] = useState("ALL");
  const [filterSegment, setFilterSegment] = useState("ALL");
  const [page, setPage] = useState(1);
  const [report, setReport] = useState<VisitReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const requestController = useRef<AbortController | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmedAt = useRef(0);

  const loadData = useCallback(async (background = false) => {
    if (!isAdmin) return;
    const requestId = ++sequence.current;
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    if (background) setRefreshing(true);
    else setLoading(true);
    try {
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (sessionError || !token) throw new Error("Your session has expired.");
      const params = new URLSearchParams({
        from: fromDate, to: toDate, page: String(page), pageSize: String(PAGE_SIZE),
      });
      if (filterAgent !== "ALL") params.set("representative", filterAgent);
      if (filterSegment !== "ALL") params.set("segment", filterSegment);
      if (filterOutcome !== "ALL") params.append("outcome", filterOutcome);
      if (searchTerm.trim()) params.set("search", searchTerm.trim());
      const response = await fetch(`/api/admin/visits?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
        signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok) throw body;
      if (requestId !== sequence.current) return;
      setReport(body as VisitReport);
      confirmedAt.current = Date.now();
      setError(null);
    } catch (caught) {
      if (requestId !== sequence.current) return;
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError("Confirmed visits could not be refreshed. The last confirmed report remains visible.");
    } finally {
      if (requestId === sequence.current) {
        setLoading(false);
        setRefreshing(false);
        requestController.current = null;
      }
    }
  }, [filterAgent, filterOutcome, filterSegment, fromDate, isAdmin, page, searchTerm, toDate]);

  useEffect(() => {
    void loadData();
    return () => requestController.current?.abort();
  }, [loadData]);

  useEffect(() => {
    if (!isAdmin) return;
    const scheduleRefresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => void loadData(true), 750);
    };
    const channel = supabase.channel("admin-confirmed-field-visits")
      .on("postgres_changes", { event: "*", schema: "public", table: "field_visits" }, scheduleRefresh)
      .subscribe();
    const visibility = () => {
      if (document.visibilityState === "visible" && Date.now() - confirmedAt.current > 60_000) scheduleRefresh();
    };
    document.addEventListener("visibilitychange", visibility);
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      document.removeEventListener("visibilitychange", visibility);
      void supabase.removeChannel(channel);
    };
  }, [isAdmin, loadData]);

  const handleExportExcel = async () => {
    setExporting(true);
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Authentication required.");
      const params = new URLSearchParams({ from: fromDate, to: toDate });
      if (filterAgent !== "ALL") params.set("representative", filterAgent);
      if (filterSegment !== "ALL") params.set("segment", filterSegment);
      if (filterOutcome !== "ALL") params.append("outcome", filterOutcome);
      if (searchTerm.trim()) params.set("search", searchTerm.trim());
      const response = await fetch(`/api/admin/export-visits?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Export failed.");
      const downloadUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `FieldVisits_${fromDate}_${toDate}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);
    } catch {
      setError("The filtered visit workbook could not be exported.");
    } finally {
      setExporting(false);
    }
  };

  if (!isAdmin) {
    return <div className="app-page"><PageHeader eyebrow="Security" title="Access Denied" description="You do not have permission to view this page." /></div>;
  }

  const rows = report?.rows ?? [];
  const totals = report?.totals ?? { total: 0, retailer: 0, distributor: 0 };
  const totalPages = Math.max(1, Math.ceil(totals.total / PAGE_SIZE));
  const activeAgents = allUsers.filter((user) => Boolean(user.is_active));

  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Field Operations"
        icon={<MapPin size={18} />}
        title="Team Field Visits"
        description="Monitor field visit compliance, check-ins, and outcomes across the organization."
        actions={<Button size="sm" variant="outline" icon={<Download size={14} />} onClick={handleExportExcel} isLoading={exporting}>Export to Excel</Button>}
      />

      {error && <div className="alert-panel alert-panel--danger" role="alert"><AlertCircle size={16} /><span>{error}</span></div>}

      <div className="metric-grid">
        <MetricCard label="Total Visits" value={totals.total} icon={<MapPin size={17} />} note="Complete filtered total" />
        <MetricCard label="Retailer Visits" value={totals.retailer} icon={<Calendar size={17} />} tone="success" note="Complete filtered total" />
        <MetricCard label="Distributor Visits" value={totals.distributor} icon={<User size={17} />} tone="brand" note="Complete filtered total" />
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <input type="date" className="field-control max-w-[170px]" value={fromDate} onChange={(event) => { setPage(1); setFromDate(event.target.value); }} aria-label="From date" />
        <input type="date" className="field-control max-w-[170px]" value={toDate} onChange={(event) => { setPage(1); setToDate(event.target.value); }} aria-label="To date" />
        <input type="search" placeholder="Search business, agent, or person met..." className="field-control max-w-sm" value={searchTerm} onChange={(event) => { setPage(1); setSearchTerm(event.target.value); }} />
        <select className="field-control max-w-xs" value={filterSegment} onChange={(event) => { setPage(1); setFilterSegment(event.target.value); }}>
          <option value="ALL">All Segments</option><option value="Retailer">Retailer</option><option value="Distributor">Distributor</option>
        </select>
        <select className="field-control max-w-xs" value={filterOutcome} onChange={(event) => { setPage(1); setFilterOutcome(event.target.value); }}>
          <option value="ALL">All Outcomes</option>
          <option value="registered">Registered</option><option value="installed">Installed</option>
          <option value="interested">Interested</option><option value="follow_up">Follow-up</option>
          <option value="not_interested">Not interested</option>
        </select>
        <select className="field-control max-w-xs" value={filterAgent} onChange={(event) => { setPage(1); setFilterAgent(event.target.value); }}>
          <option value="ALL">All Agents</option>
          {activeAgents.map((agent) => <option key={agent.user_id} value={agent.user_id}>{agent.name}</option>)}
        </select>
      </div>

      <div className="workspace-split">
        <QueueList
          title="Field Visit History"
          items={rows.map((visit) => visitItem(visit))}
          emptyMessage={loading ? "Loading confirmed visits…" : "No confirmed field visits match these filters."}
          onRefresh={() => void loadData(true)}
        />
      </div>
      <div className="mt-4 flex items-center justify-end gap-3 text-[12px] text-[var(--text-muted)]">
        <span>Page {page} of {totalPages}{refreshing ? " · Refreshing…" : ""}</span>
        <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Previous</Button>
        <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Next</Button>
      </div>
    </div>
  );
}

function visitItem(visit: VisitReportRow) {
  return {
    id: visit.visit_id,
    primaryNode: (
      <div>
        <p className="text-[13px] font-semibold leading-snug text-[var(--text-primary)]">
          {visit.business_name || visit.lead_id}
          {visit.segment_type && <span className="ml-2 text-xs font-normal text-[var(--text-secondary)]">({visit.segment_type})</span>}
        </p>
        <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">
          Rep · <span className="normal-case tracking-normal text-[var(--text-secondary)]">{visit.representative_name}</span>
        </p>
        <div className="mt-2 flex gap-2 text-xs text-[var(--text-secondary)]">
          <span className="rounded border border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-2 py-0.5 font-medium">{visit.visit_outcome}</span>
          {visit.person_met && <span>Met: {visit.person_met}</span>}
        </div>
        <div className="mt-2 flex gap-4 text-[11px] text-[var(--text-secondary)]">
          <span>Coordinates: {visit.check_in_lat == null ? "None" : `${visit.check_in_lat.toFixed(5)}, ${visit.check_in_lng?.toFixed(5)}`}</span>
          {visit.selfie_storage_path && <EvidenceButton visitId={visit.visit_id} />}
        </div>
        {visit.visit_notes && <p className="mt-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--surface-primary)] p-2.5 text-[12px] leading-5 text-[var(--text-secondary)]">{visit.visit_notes}</p>}
      </div>
    ),
    statusText: visit.visit_outcome,
    statusVariant: "brand" as const,
    timestamp: new Date(visit.check_in_time).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
  };
}

function EvidenceButton({ visitId }: { visitId: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const openEvidence = async () => {
    setLoading(true);
    setError(false);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Authentication required.");
      const response = await fetch(`/api/admin/visits/evidence?visitId=${encodeURIComponent(visitId)}`, {
        headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok || typeof body.signedUrl !== "string") throw new Error("Evidence unavailable.");
      window.open(body.signedUrl, "_blank", "noopener,noreferrer");
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };
  return <button type="button" className="text-[var(--brand-600)] hover:underline" onClick={openEvidence} disabled={loading}>
    <span className="inline-flex items-center gap-1"><ImageIcon size={12} />{error ? "Retry evidence" : loading ? "Opening…" : "View selfie"}</span>
  </button>;
}
