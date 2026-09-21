"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Download } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import type { LocalFieldVisit } from "@/lib/db";
import { getCurrentISTDate } from "@/lib/dateTime";
import { supabase } from "@/lib/supabaseClient";
import { PageHeader } from "@/components/ui/PageHeader";
import { ContextRail } from "@/components/workspace/ContextRail";
import { Chip } from "@/components/ui/Chip";
import { Button } from "@/components/ui/Button";
import { MetricCard } from "@/components/ui/MetricCard";

const metricCardClass = "min-w-0 [&]:min-h-0 [&]:p-3 [&]:gap-1 [&_[data-slot=card-footer]]:mt-1 [&_[data-slot=card-footer]]:text-[10px] [&_[data-slot=card-footer]]:leading-3";
const outcomeKeys = ["registered", "installed", "interested", "follow_up", "payment_follow_up", "payment_done", "not_interested"] as const;
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { getOutcomeLabel } from "@/lib/fieldVisits/contract";
import { AnalyticsSkeleton } from "@/components/analytics/AnalyticsPanel";
import { adminVisitOutcomeLabel as getAdminOutcomeLabel, initialVisitQuery, visitQueryKey, visitQueryParams, type VisitQuery } from "@/lib/fieldVisits/query";
import { parseVisitSummary, visitSummaryReportSchema, type VisitSummaryReport } from "@/lib/fieldVisits/range";
import type { FieldVisitErpSegment } from "@/components/analytics/FieldVisitErpIntelligence";

const VisitSummaryCharts = dynamic(() => import("./VisitSummaryCharts"), {
  ssr: false,
  loading: () => <AnalyticsSkeleton label="Loading field activity intelligence" />,
});
const FieldVisitErpIntelligence = dynamic(() => import("@/components/analytics/FieldVisitErpIntelligence"), { ssr: false, loading: () => <AnalyticsSkeleton label="Loading ERP intelligence" /> });
const CurrentErpBaselineEditor = dynamic(() => import("@/components/visits/CurrentErpBaselineEditor"), { ssr: false });

interface AdminVisit extends LocalFieldVisit {
  has_selfie_evidence?: boolean;
  selfie_status?: "AVAILABLE" | "PURGED" | "PENDING";
  confirmation_status?: string;
  users?: { name?: string | null; email?: string | null } | null;
  leads?: { business_name?: string | null; contact_person?: string | null; phone?: string | null } | null;
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
  const { isAdmin, currentUser } = useAuth();
  if (!isAdmin || !currentUser) return <div className="app-page"><PageHeader eyebrow="Security" title="Access Denied" description="You do not have permission to view this page." /></div>;
  return <AdminVisitsWorkspace key={currentUser.user_id} />;
}

function AdminVisitsWorkspace() {
  const { isAdmin, currentUser } = useAuth();
  const actorId = currentUser?.user_id;
  const [initialQuery] = useState(initialVisitQuery);
  const appliedQuery = useRef(initialQuery);
  const intendedQuery = useRef(initialQuery);
  const [appliedKey, setAppliedKey] = useState("");
  const attempted = useRef({ query: initialQuery, page: 1 });
  const registerRequest = useRef<AbortController | null>(null);
  const failedRequest = useRef(false);
  const exportRequest = useRef<AbortController | null>(null);
  const [exportError, setExportError] = useState("");
  const [selected, setSelected] = useState<{ visit: AdminVisit; scope: string } | null>(null);
  const visitTrigger = useRef<HTMLButtonElement | null>(null);
  const [appliedScope, setAppliedScope] = useState("No applied scope yet");
  const [appliedGlobalScope, setAppliedGlobalScope] = useState("");
  const [visits, setVisits] = useState<AdminVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [appliedPage, setAppliedPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [allTimeTotal, setAllTimeTotal] = useState<number | null>(null);
  const [todayTotal, setTodayTotal] = useState<number | null>(null);
  const [matchedTotal, setMatchedTotal] = useState(0);
  const [legacyMismatchCount, setLegacyMismatchCount] = useState(0);
  const [dateFrom, setDateFrom] = useState(initialQuery.dateFrom);
  const [dateTo, setDateTo] = useState(initialQuery.dateTo);
  const [dateMode, setDateMode] = useState<"all" | "today" | "single" | "range">("all");
  const [dateError, setDateError] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [search, setSearch] = useState("");
  const [representative, setRepresentative] = useState("ALL");
  const [segment, setSegment] = useState("ALL");
  const [outcome, setOutcome] = useState("ALL");
  const [representatives, setRepresentatives] = useState<Array<{ user_id: string; name: string | null; email: string | null; is_active: boolean; historical_only: boolean }>>([]);
  const [representativeSearch, setRepresentativeSearch] = useState("");
  const [representativeError, setRepresentativeError] = useState("");
  const [representativeLoading, setRepresentativeLoading] = useState(false);
  const [representativeLoaded, setRepresentativeLoaded] = useState(false);
  const [representativeCursor, setRepresentativeCursor] = useState<{ after_name: string; after_id: string } | null>(null);
  const representativeQuery = useRef("");
  const representativeRequest = useRef<AbortController | null>(null);
  const requestSequence = useRef(0);
  const committedSearch = useRef("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const realtimeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibilityWasHidden = useRef(false);
  const [realtimeSubscribed, setRealtimeSubscribed] = useState(false);
  const [analyticsMode, setAnalyticsMode] = useState<"activity" | "erp">("activity");
  const [analysis, setAnalysis] = useState<{ key: string; report: VisitSummaryReport | null; error: string } | null>(null);
  const [analysisRevision, setAnalysisRevision] = useState(0);
  const [manageCurrentErpOpen, setManageCurrentErpOpen] = useState(false);
  const [erpSegments, setErpSegments] = useState<Record<string, FieldVisitErpSegment> | null>(null);
  const [erpError, setErpError] = useState("");
  const erpRequest = useRef<AbortController | null>(null);
  const loadData = useCallback(async (targetPage = 1, query = appliedQuery.current) => {
    if (!isAdmin || !actorId) return;
    registerRequest.current?.abort();
    const controller = new AbortController();
    registerRequest.current = controller;
    attempted.current = { query, page: targetPage };
    const sequence = ++requestSequence.current;
    setLoading(true);
    setErrorMessage("");
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (controller.signal.aborted) return;
      const token = sessionData.session?.access_token;
      if (!token || sessionData.session?.user.id !== actorId) throw new Error("Authentication required");
      const params = visitQueryParams(query);
      params.set("page", String(targetPage));
      const response = await fetch(`/api/admin/visits?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store", signal: controller.signal,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Unable to load field visits");
      if (sequence !== requestSequence.current || controller.signal.aborted) return;
      const { date, dateFrom, dateTo, representative, segment, outcome, search } = query;
      appliedQuery.current = query;
      setAppliedKey(visitQueryKey(query));
      setVisits(result.visits ?? []);
      const dateScope = date || (dateFrom && dateTo ? (dateFrom === dateTo ? dateFrom : `${dateFrom} to ${dateTo}`) : "All time");
      setAppliedScope(`${dateScope} · ${representative === "ALL" ? "All representatives" : representative} · ${segment === "ALL" ? "All segments" : segment} · ${outcome === "ALL" ? "All outcomes" : getAdminOutcomeLabel(outcome)}${search.trim() ? ` · Search: ${search.trim()}` : ""}`);
      setAppliedGlobalScope(`${representative === "ALL" ? "All representatives" : representative} · ${segment} segments · ${outcome === "ALL" ? "All outcomes" : getAdminOutcomeLabel(outcome)}`);
      setAppliedPage(result.page ?? targetPage);
      setHasMore(Boolean(result.has_more) && targetPage < 400);
      setAllTimeTotal(result.all_time_total ?? null);
      setTodayTotal(result.today_total ?? null);
      setMatchedTotal(result.total ?? 0);
      setLegacyMismatchCount(result.legacy_date_mismatch_count ?? 0);
      setHasLoaded(true);
      failedRequest.current = false;
    } catch (error) {
      if (sequence !== requestSequence.current || controller.signal.aborted) return;
      console.error("Failed to load admin visits:", error);
      setErrorMessage(error instanceof Error ? error.message : "Unable to load field visits");
      failedRequest.current = true;
    } finally {
      if (sequence === requestSequence.current && !controller.signal.aborted) setLoading(false);
      if (registerRequest.current === controller) registerRequest.current = null;
    }
  }, [actorId, isAdmin]);

  const commitQuery = useCallback((change: Partial<VisitQuery>) => {
    if (searchTimer.current) { clearTimeout(searchTimer.current); searchTimer.current = null; }
    const next = { ...intendedQuery.current, ...change };
    intendedQuery.current = next;
    if (Boolean(next.dateFrom) !== Boolean(next.dateTo) || (next.dateFrom && next.dateTo && next.dateFrom > next.dateTo)) {
      setDateError("Choose both From and To dates in chronological order.");
      return;
    }
    setDateError("");
    void loadData(1, next);
  }, [loadData]);

  const loadRepresentatives = async (next = false) => {
    representativeRequest.current?.abort();
    const controller = new AbortController();
    representativeRequest.current = controller;
    setRepresentativeLoading(true); setRepresentativeError("");
    const search = next ? representativeQuery.current : representativeSearch.trim();
    try {
      const { data } = await supabase.auth.getSession();
      if (controller.signal.aborted) return;
      if (!data.session?.access_token || data.session.user.id !== actorId) throw new Error("Authentication required.");
      const params = new URLSearchParams({ search });
      if (representative !== "ALL") params.set("selected", representative);
      if (next && representativeCursor) { params.set("after_name", representativeCursor.after_name); params.set("after_id", representativeCursor.after_id); }
      const response = await fetch(`/api/admin/visits/representatives?${params}`, { headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: "no-store", signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.code === "VISIT_READER_ACTIVATION_REQUIRED" ? "Representative search requires reader activation. Existing records remain available." : "Representative search unavailable. Retry Search representatives.");
      if (controller.signal.aborted) return;
      const items = result.items as typeof representatives;
      setRepresentatives((current) => {
        const combined = next ? [...current, ...items] : items;
        if (result.selected && !combined.some((item) => item.user_id === result.selected.user_id)) combined.unshift(result.selected);
        return [...new Map(combined.map((item) => [item.user_id, item])).values()];
      });
      setRepresentativeCursor(result.next_cursor); representativeQuery.current = search;
      setRepresentativeLoaded(true);
    } catch (error) {
      if (!controller.signal.aborted) setRepresentativeError(error instanceof Error ? error.message : "Representative search unavailable.");
    } finally {
      if (!controller.signal.aborted) setRepresentativeLoading(false);
      if (representativeRequest.current === controller) representativeRequest.current = null;
    }
  };

  // Register pagination never refetches the aggregate; a confirmed filter key does.
  useEffect(() => {
    if (!hasLoaded || !actorId) return;
    const query = appliedQuery.current;
    const controller = new AbortController();
    const load = async () => {
      setAnalysis(null);
      try {
        const params = visitQueryParams(query);
        const expected = parseVisitSummary(params, new Date().toISOString());
        const { data } = await supabase.auth.getSession();
        if (controller.signal.aborted) return;
        if (!data.session?.access_token || data.session.user.id !== actorId) throw new Error("Sign in again to load analysis.");
        const response = await fetch(`/api/admin/visits/analysis?${params}`, { headers: { Authorization: `Bearer ${data.session.access_token}` }, cache: "no-store", signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.code === "VISIT_READER_ACTIVATION_REQUIRED" ? "Visit summary requires reviewed reader activation. Existing records remain available." : "Visit summary is unavailable. The confirmed register scope remains visible.");
        const report = visitSummaryReportSchema.parse(body);
        if (JSON.stringify(report.scope) !== JSON.stringify(expected)) throw new Error("Analysis returned a different scope. Retry analysis.");
        if (!controller.signal.aborted) setAnalysis({ key: appliedKey, report, error: "" });
      } catch (error) {
        if (!controller.signal.aborted) setAnalysis({ key: appliedKey, report: null, error: error instanceof Error ? error.message : "Analysis unavailable." });
      }
    };
    void load();
    return () => controller.abort();
  }, [actorId, appliedKey, hasLoaded, analysisRevision]);

  useEffect(() => {
    intendedQuery.current = { ...intendedQuery.current, search };
    if (committedSearch.current === search) return;
    committedSearch.current = search;
    searchTimer.current = setTimeout(() => { searchTimer.current = null; commitQuery({ search }); }, 300);
    return () => { if (searchTimer.current) { clearTimeout(searchTimer.current); searchTimer.current = null; } };
  }, [commitQuery, search]);

  const loadErpIntelligence = useCallback(async () => {
    if (!isAdmin || !actorId || erpRequest.current) return;
    const controller = new AbortController();
    erpRequest.current = controller;
    setErpError("");
    try {
      const { data } = await supabase.auth.getSession();
      if (controller.signal.aborted) return;
      const token = data.session?.access_token;
      if (!token || data.session?.user.id !== actorId) throw new Error("Authentication required.");
      const response = await fetch("/api/admin/visits/erp-analytics", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("ERP intelligence is temporarily unavailable.");
      const result = await response.json();
      if (!controller.signal.aborted) setErpSegments(result.segments ?? {});
    } catch {
      if (!controller.signal.aborted) setErpError("ERP intelligence is temporarily unavailable. Retry when ready.");
    } finally {
      if (erpRequest.current === controller) erpRequest.current = null;
    }
  }, [actorId, isAdmin]);

  useEffect(() => { if (!isAdmin || analyticsMode !== "erp" || erpSegments || erpError) return; queueMicrotask(() => void loadErpIntelligence()); }, [analyticsMode, erpError, erpSegments, isAdmin, loadErpIntelligence]);

  useEffect(() => {
    let alive = true;
    const sequence = requestSequence;
    queueMicrotask(() => {
      if (!alive) return;
      void loadData(1, initialQuery);
    });
    return () => { alive = false; ++sequence.current; if (searchTimer.current) clearTimeout(searchTimer.current); registerRequest.current?.abort(); representativeRequest.current?.abort(); exportRequest.current?.abort(); erpRequest.current?.abort(); erpRequest.current = null; };
  }, [initialQuery, loadData]);

  useEffect(() => {
    if (!isAdmin) return;
    const scheduleRefresh = () => {
      if (realtimeTimer.current) clearTimeout(realtimeTimer.current);
      setErpSegments(null);
      realtimeTimer.current = setTimeout(() => { if (!registerRequest.current && !failedRequest.current) void loadData(appliedPage); }, 350);
    };
    const channel = supabase.channel("admin-field-visits-authoritative")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "field_visits" }, scheduleRefresh)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "field_visits" }, scheduleRefresh)
      .subscribe((status) => setRealtimeSubscribed(status === "SUBSCRIBED"));
    return () => {
      if (realtimeTimer.current) clearTimeout(realtimeTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [isAdmin, loadData, appliedPage]);

  useEffect(() => {
    const updateFallback = () => {
      if (document.visibilityState !== "visible") { visibilityWasHidden.current = true; return; }
      if (visibilityWasHidden.current && !realtimeSubscribed && hasLoaded && !registerRequest.current && !failedRequest.current) {
        visibilityWasHidden.current = false;
        void loadData(appliedPage);
      }
    };
    document.addEventListener("visibilitychange", updateFallback);
    return () => { document.removeEventListener("visibilitychange", updateFallback); };
  }, [loadData, appliedPage, realtimeSubscribed, hasLoaded]);

  const handleExport = async () => {
    exportRequest.current?.abort();
    const controller = new AbortController();
    exportRequest.current = controller;
    const query = appliedQuery.current;
    setExporting(true);
    setExportError("");
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (controller.signal.aborted) return;
      const token = sessionData.session?.access_token;
      if (!token || sessionData.session?.user.id !== actorId) throw new Error("Authentication required");
      const params = visitQueryParams(query);
      const response = await fetch(`/api/admin/export-visits?${params}`, {
        headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      if (!response.ok) {
        const failure = await response.json().catch(() => null);
        if (controller.signal.aborted) return;
        throw new Error(typeof failure?.error === "string" ? failure.error : "Export unavailable. Narrow the range and retry.");
      }
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      const downloadUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = `FieldVisitsExport_${query.date || query.dateFrom || "all"}.xlsx`;
      anchor.click();
      URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      if (!controller.signal.aborted) setExportError(error instanceof Error ? error.message : "Export failed. Retry Export to Excel.");
    } finally {
      if (!controller.signal.aborted) setExporting(false);
      if (exportRequest.current === controller) exportRequest.current = null;
    }
  };
  const filtersPending = visitQueryKey({ date: "", dateFrom, dateTo, search, representative, segment, outcome }) !== appliedKey;

  return (
    <div className="app-page min-w-0 crm-workspace">
      <header className="workspace-heading"><div><h1>Visits overview</h1><p>Confirmed field records · India business dates</p></div><Button size="sm" variant="outline" title="Export the confirmed record filters" icon={<Download size={14} />} onClick={handleExport} isLoading={exporting} disabled={!hasLoaded || loading || filtersPending || Boolean(dateError)}>Export to Excel</Button></header>
      <section aria-label="Visit metrics" className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <MetricCard label="All-time visits" value={hasLoaded ? allTimeTotal?.toLocaleString("en-IN") ?? <span className="text-base tracking-normal">Unavailable</span> : "—"} note="Excludes date and search" className={metricCardClass} />
        <MetricCard label="Visits today" value={hasLoaded ? todayTotal?.toLocaleString("en-IN") ?? <span className="text-base tracking-normal">Unavailable</span> : "—"} note="India date · excludes search" className={metricCardClass} />
        <MetricCard label="Matching visits" value={hasLoaded ? matchedTotal.toLocaleString("en-IN") : "—"} note="Confirmed filter scope" className={metricCardClass} />
      </section>
      <section aria-label="Visit outcome totals" className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        {outcomeKeys.map((key) => <MetricCard key={key} label={getAdminOutcomeLabel(key)} value={analysis?.key === appliedKey && analysis.report ? analysis.report.outcomes[key].toLocaleString("en-IN") : <span className="text-base tracking-normal">Unavailable</span>} note="Confirmed scope" className={metricCardClass} />)}
        {analysis?.key === appliedKey && analysis.report && analysis.report.unknown_outcome_count > 0 && <MetricCard label="Unknown / legacy" value={analysis.report.unknown_outcome_count.toLocaleString("en-IN")} note="Confirmed scope" className={metricCardClass} />}
      </section>
      {hasLoaded && <p className="text-xs text-[var(--text-secondary)]">Global counts: {appliedGlobalScope}. Unavailable counts are not zero.</p>}
      {exportError && <p role="alert" className="alert-panel alert-panel--danger">{exportError}</p>}
      <div aria-label="Visit filters" className="grid grid-cols-2 items-end gap-2 sm:grid-cols-5">
        <label className="order-0 grid min-w-0 gap-1 text-xs sm:col-span-2">Search visits<input aria-label="Search visits" className="field-control min-w-0" placeholder="Business, representative, or notes" value={search} maxLength={160} onChange={(event) => setSearch(event.target.value)} /></label>
        <label className="order-0 grid min-w-0 gap-1 text-xs">Date<select aria-label="Date scope" className="field-control min-w-0" value={dateMode} onChange={(event) => { const mode = event.target.value as typeof dateMode; setDateMode(mode); if (mode === "all") { setDateFrom(""); setDateTo(""); commitQuery({ date: "", dateFrom: "", dateTo: "" }); } else if (mode === "today") { const today = getCurrentISTDate(); setDateFrom(today); setDateTo(today); commitQuery({ date: "", dateFrom: today, dateTo: today }); } else { setDateFrom(""); setDateTo(""); intendedQuery.current = { ...intendedQuery.current, date: "", dateFrom: "", dateTo: "" }; setDateError(mode === "single" ? "Choose a date." : "Choose both From and To dates."); } }}><option value="all">All time</option><option value="today">Today</option><option value="single">Single date</option><option value="range">Custom range</option></select></label>
        {dateMode === "single" && <div className="order-1 grid min-w-0 gap-1 text-xs"><label className="grid gap-1">Visit date<input aria-label="Visit date" type="date" className="field-control min-w-0" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setDateTo(event.target.value); commitQuery({ date: "", dateFrom: event.target.value, dateTo: event.target.value }); }} /></label></div>}
        {dateMode === "range" && <><div className="order-1 grid min-w-0 gap-1 text-xs"><label className="grid gap-1">From<input aria-label="Date From" type="date" className="field-control min-w-0" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); commitQuery({ date: "", dateFrom: event.target.value, dateTo }); }} /></label></div><div className="order-1 grid min-w-0 gap-1 text-xs"><label className="grid gap-1">To<input aria-label="Date To" type="date" className="field-control min-w-0" value={dateTo} onChange={(event) => { setDateTo(event.target.value); commitQuery({ date: "", dateFrom, dateTo: event.target.value }); }} /></label></div></>}
        <div className="grid min-w-0 gap-3 text-xs text-[var(--text-secondary)] sm:grid-cols-2 [&_label]:grid [&_label]:min-w-0 [&_label]:gap-1"><label>Representative
        <select aria-label="Representative" className="field-control min-w-0" value={representative} onFocus={() => { if (!representativeLoaded && !representativeRequest.current && !representativeError) void loadRepresentatives(); }} onChange={(event) => { setRepresentative(event.target.value); commitQuery({ representative: event.target.value }); }}>
          <option value="ALL">All representatives</option>
          {representative !== "ALL" && !representatives.some((user) => user.user_id === representative) && <option value={representative}>Selected identity · {representative}</option>}
          {representatives.map((user) => <option key={user.user_id} value={user.user_id}>{user.name || user.user_id}{user.email ? ` (${user.email})` : ""}{user.is_active ? "" : " — inactive"}{user.historical_only ? " — historical" : ""}</option>)}
        </select></label><label>Outcome
        <select aria-label="Outcome" className="field-control min-w-0" value={outcome} onChange={(event) => { setOutcome(event.target.value); commitQuery({ outcome: event.target.value }); }}>
          <option value="ALL">All outcomes</option>
          {outcomeKeys.map((value) => <option key={value} value={value}>{getOutcomeLabel(value)}</option>)}
        </select></label></div>
        <div className="col-span-2 flex flex-wrap items-end gap-2 sm:col-span-5"><label className="grid min-w-0 flex-1 gap-1 text-xs">Find representative<input aria-label="Find representative" className="field-control" placeholder="Name or email" value={representativeSearch} maxLength={160} onChange={(event) => setRepresentativeSearch(event.target.value)} /></label><Button type="button" size="sm" variant="outline" disabled={representativeLoading} onClick={() => void loadRepresentatives()}>Search</Button><Button type="button" size="sm" variant="outline" disabled={!representativeCursor || representativeLoading} onClick={() => void loadRepresentatives(true)}>Load more</Button><Button type="button" size="sm" variant="outline" onClick={() => { const query = initialVisitQuery(); intendedQuery.current = query; committedSearch.current = ""; setDateFrom(""); setDateTo(""); setDateMode("all"); setDateError(""); setSearch(""); setRepresentative("ALL"); setSegment("ALL"); setOutcome("ALL"); void loadData(1, query); }}>Clear filters</Button></div>{representativeLoading && <p role="status" className="text-xs">Loading representative options…</p>}{representativeError && <p role="alert" className="text-xs">{representativeError}</p>}
        <div className="grid min-w-0 gap-3 text-xs text-[var(--text-secondary)] [&_label]:grid [&_label]:min-w-0 [&_label]:gap-1"><label>Segment
        <select aria-label="Segment" className="field-control min-w-0" value={segment} onChange={(event) => { setSegment(event.target.value); commitQuery({ segment: event.target.value }); }}>
          <option value="ALL">All segments</option><option value="Retailer">Retailer</option><option value="Distributor">Distributor</option>
        </select></label></div>
        {dateError && <p role="alert" className="col-span-2 text-xs text-red-600 sm:col-span-5">{dateError} The last confirmed scope remains visible.</p>}
        {hasLoaded && filtersPending && !dateError && <p role="status" className="col-span-2 text-xs sm:col-span-5">Updating filters. The last confirmed scope remains visible.</p>}
      </div>
      {legacyMismatchCount > 0 && <div role="status" className="alert-panel alert-panel--warning">Included {legacyMismatchCount} confirmed visits whose stored date differs from their India check-in date.</div>}
      {errorMessage && <div role="alert" className="alert-panel alert-panel--danger">{errorMessage} {hasLoaded && <span>The last confirmed records and their applied scope remain visible.</span>} <Button size="sm" variant="outline" onClick={() => void loadData(attempted.current.page, attempted.current.query)}>Retry request</Button></div>}
      <p className="text-xs text-[var(--text-secondary)]" aria-live="polite">{hasLoaded ? `Applied: ${appliedScope} · Loaded page ${appliedPage} · ${visits.length} of ${matchedTotal} matching visits` : "Loading confirmed visits…"}{loading && hasLoaded ? " · Refreshing…" : ""}</p>
      <Tabs value={analyticsMode} onValueChange={(value) => setAnalyticsMode(value as "activity" | "erp")} activationMode="manual" className="gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><TabsList aria-label="Visit analytics"><TabsTrigger value="activity" aria-label="Visit Activity">Activity</TabsTrigger><TabsTrigger value="erp">ERP Intelligence</TabsTrigger></TabsList>
          {analyticsMode === "activity" && <Button size="sm" variant="outline" disabled={!hasLoaded || loading} onClick={() => { setAnalysisRevision(value => value + 1); void loadData(1, appliedQuery.current); }}>Refresh</Button>}</div>
        <TabsContent value="activity">{analyticsMode === "activity" && hasLoaded && <div className="space-y-3">
          {!analysis || analysis.key !== appliedKey ? <AnalyticsSkeleton label="Loading full-range Visit activity" /> : analysis.report ? <VisitSummaryCharts visits={visits} page={appliedPage} report={analysis.report} scope={appliedScope} matchedTotal={matchedTotal} onOutcome={(key) => { setOutcome(key); commitQuery({ outcome: key }); }} onRepresentative={(id) => { setRepresentative(id); commitQuery({ representative: id }); }} /> : <p role="status" className="alert-panel alert-panel--warning">{analysis.error}</p>}
        </div>}</TabsContent>
      <TabsContent value="erp" className="order-3 space-y-4 sm:order-2">
        {analyticsMode === "erp" && <>
          <p className="text-sm leading-5 text-[var(--text-secondary)]">Current ERP footprint counts unique businesses across confirmed visits and Admin baselines. Visit filters above apply to the register and activity view, not this footprint.</p>
          {erpSegments ? <FieldVisitErpIntelligence segments={erpSegments} /> : erpError ? <div role="alert" className="alert-panel alert-panel--danger">{erpError} <Button size="sm" variant="outline" onClick={() => void loadErpIntelligence()}>Retry</Button></div> : <AnalyticsSkeleton label="Loading ERP intelligence" />}
          <Button size="sm" variant="outline" className="min-h-11" onClick={() => setManageCurrentErpOpen((open) => !open)}>{manageCurrentErpOpen ? "Close Current ERP" : "Manage Current ERP"}</Button>
          {manageCurrentErpOpen && <CurrentErpBaselineEditor onSaved={() => { setErpSegments(null); setErpError(""); void loadErpIntelligence(); }} />}
        </>}
      </TabsContent>

      </Tabs>
      <div className="workspace-columns">
        <section className="workspace-register" data-workspace-register tabIndex={-1} aria-label="Confirmed visit history">
          <header className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-2"><h2 className="text-base font-semibold">Visit register</h2><Button size="sm" variant="ghost" onClick={() => { setAnalysisRevision(value => value + 1); void loadData(1, appliedQuery.current); }}>Refresh</Button></header>
          <ol key={appliedPage} aria-label="Loaded Visit records" tabIndex={0} className="max-h-96 overflow-y-auto divide-y divide-[var(--border-subtle)]">{visits.map((visit) => <li key={visit.visit_id} className="workspace-task-row" data-selected={selected?.visit.visit_id === visit.visit_id}>
            <div className="min-w-0 flex-1"><button type="button" className="min-h-11 text-left text-sm font-semibold" aria-pressed={selected?.visit.visit_id === visit.visit_id} onClick={(event) => { visitTrigger.current = event.currentTarget; setSelected({ visit, scope: `${appliedScope} · Page ${appliedPage}` }); }}>{visit.leads?.business_name?.trim() || visit.lead_id?.trim() || "Unavailable business"}</button><p className="text-xs text-[var(--text-secondary)]">{visit.users?.name || "Unknown representative"} · {visit.segment_type} · {new Date(visit.check_in_time).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })} IST</p></div>
            <Chip variant={getAdminOutcomeVariant(visit.visit_outcome)} size="sm">{getAdminOutcomeLabel(visit.visit_outcome)}</Chip>
          </li>)}</ol>
          {!visits.length && <div className="p-4 text-sm"><p>{loading ? "Loading visits…" : "No confirmed visits match these filters."}</p></div>}
          <footer className="flex items-center justify-between border-t border-[var(--border-subtle)] p-3"><span className="text-xs">Loaded page {appliedPage}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={appliedPage <= 1 || loading} onClick={() => void loadData(appliedPage - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={!hasMore || loading} onClick={() => void loadData(appliedPage + 1)}>Next</Button></div></footer>
          {appliedPage === 400 && matchedTotal > 20000 && <p role="status" className="p-3 text-sm">Display limit reached. Narrow the date range or filters to inspect additional records.</p>}
        </section>
        <ContextRail open={Boolean(selected)} title={selected?.visit.leads?.business_name || selected?.visit.lead_id || "Visit detail"} description={selected ? `${selected.visit.segment_type} · ${getAdminOutcomeLabel(selected.visit.visit_outcome)}` : "Select a visit"} onClose={() => setSelected(null)} returnFocus={visitTrigger}>
          {selected && <VisitDetail key={selected.visit.visit_id} visit={selected.visit} scope={selected.scope} />}
        </ContextRail>
      </div>
    </div>
  );
}

function VisitDetail({ visit, scope }: { visit: AdminVisit; scope: string }) {
  const field = "grid gap-0.5 min-w-0";
  const label = "text-[11px] font-medium uppercase tracking-wide text-[var(--text-secondary)]";
  const value = "break-words text-[13px] leading-5 text-[var(--text-primary)]";
  return <div className="space-y-3">
    <p className="text-[11px] text-[var(--text-secondary)]">Selected from {scope}</p>
    <section className="space-y-2 border-b border-[var(--border-subtle)] pb-3"><h3 className="text-xs font-semibold">Contact</h3><dl className="grid grid-cols-2 gap-x-3 gap-y-2">
      <div className={`${field} col-span-2`}><dt className={label}>Representative</dt><dd className={value}>{visit.users?.name || "Unknown"} · {visit.users?.email || "Email unavailable"}</dd></div>
      <div className={field}><dt className={label}>Person met</dt><dd className={value}>{visit.person_met || "Unavailable"}</dd></div>
      <div className={field}><dt className={label}>Pincode</dt><dd className={value}>{visit.pincode?.trim() || "Not captured"}</dd></div>
      <div className={`${field} col-span-2`}><dt className={label}>{visit.segment_type === "Retailer" ? "Area" : "Address"}</dt><dd className={`${value} whitespace-pre-wrap`}>{visit.address?.trim() || "Legacy visit — address was not captured"}</dd></div>
    </dl></section>
    <section className="space-y-2 border-b border-[var(--border-subtle)] pb-3"><h3 className="text-xs font-semibold">Visit</h3><dl className="grid grid-cols-2 gap-x-3 gap-y-2">
      <div className={field}><dt className={label}>ERP at visit</dt><dd className={value}>{visit.erp_usage_state === "erp" ? visit.erp_name || "Not captured" : visit.erp_usage_state === "none" ? "None" : "Not captured"}</dd></div>
      <div className={field}><dt className={label}>Follow-up</dt><dd className={value}>{visit.follow_up_date || "None recorded"}</dd></div>
      <div className={field}><dt className={label}>Sync</dt><dd className={value}>{visit.sync_status || "Confirmed"}</dd></div>
      <div className={field}><dt className={label}>GPS</dt><dd className={value}>{visit.check_in_lat != null && visit.check_in_lng != null ? <a target="_blank" rel="noreferrer" className="underline" href={`https://www.google.com/maps?q=${visit.check_in_lat},${visit.check_in_lng}`}>{visit.check_in_lat}, {visit.check_in_lng} · Open Location</a> : "Not captured"}</dd></div>
    </dl></section>
    <section className="space-y-2"><h3 className="text-xs font-semibold">Notes</h3><p className={`${value} whitespace-pre-wrap`}>{visit.visit_notes || "None recorded"}</p></section>
    {visit.selfie_status === "AVAILABLE" ? <EvidenceButton visitId={visit.visit_id} /> : <p className={value}>{visit.selfie_status === "PURGED" ? "Selfie captured · Expired after 5-day retention" : "Evidence pending"}</p>}
  </div>;
}

function EvidenceButton({ visitId }: { visitId: string }) {
  const { currentUser } = useAuth();
  const request = useRef<AbortController | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => () => request.current?.abort(), []);
  const openEvidence = async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    setLoading(true); setError("");
    try {
      const { data } = await supabase.auth.getSession();
      if (controller.signal.aborted) return;
      const token = data.session?.access_token;
      if (!token || data.session?.user.id !== currentUser?.user_id) throw new Error("Sign in again to view evidence.");
      const response = await fetch(`/api/admin/visits/evidence?visit_id=${encodeURIComponent(visitId)}`, {
        headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
      });
      if (!response.ok) throw new Error("Evidence is unavailable. Please retry.");
      const result = await response.json();
      if (controller.signal.aborted) return;
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Evidence could not be opened."); } finally {
      if (!controller.signal.aborted) setLoading(false);
      if (request.current === controller) request.current = null;
    }
  };
  return <div><Button size="sm" variant="outline" isLoading={loading} onClick={openEvidence}>View Selfie</Button>{error && <p role="alert">{error}</p>}</div>;
}
