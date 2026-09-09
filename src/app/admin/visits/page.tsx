"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/Tabs";
import { getOutcomeLabel } from "@/lib/fieldVisits/contract";
import { AnalyticsSkeleton } from "@/components/analytics/AnalyticsPanel";
import { buildVisitAnalytics } from "@/lib/analytics/viewModels";
import type { FieldVisitErpSegment } from "@/components/analytics/FieldVisitErpIntelligence";

const VisitsIntelligence = dynamic(() => import("@/components/analytics/VisitsIntelligence"), {
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
  const [selected, setSelected] = useState<{ visit: AdminVisit; scope: string } | null>(null);
  const visitTrigger = useRef<HTMLButtonElement | null>(null);
  const [appliedScope, setAppliedScope] = useState("No applied scope yet");
  const [appliedGlobalScope, setAppliedGlobalScope] = useState("");
  const [visits, setVisits] = useState<AdminVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState(1);
  const [appliedPage, setAppliedPage] = useState(1);
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
  const [analyticsMode, setAnalyticsMode] = useState<"activity" | "erp">("activity");
  const [manageCurrentErpOpen, setManageCurrentErpOpen] = useState(false);
  const [erpSegments, setErpSegments] = useState<Record<string, FieldVisitErpSegment> | null>(null);
  const [erpError, setErpError] = useState("");
  const erpInFlight = useRef(false);

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
      setAppliedScope(`${date || `${dateFrom || "All dates"} to ${dateTo || "present"}`} · ${representative === "ALL" ? "All representatives" : (result.representatives as typeof representatives | undefined)?.find((row) => row.user_id === representative)?.name || representative} · ${segment} segments · ${outcome === "ALL" ? "All outcomes" : getAdminOutcomeLabel(outcome)}${search.trim() ? ` · Search: ${search.trim()}` : ""}`);
      setAppliedGlobalScope(`${representative === "ALL" ? "All representatives" : representative} · ${segment} segments · ${outcome === "ALL" ? "All outcomes" : getAdminOutcomeLabel(outcome)}`);
      setPage(result.page ?? targetPage);
      setAppliedPage(result.page ?? targetPage);
      setHasMore(Boolean(result.has_more));
      setAllTimeTotal(result.all_time_total ?? 0);
      setTodayTotal(result.today_total ?? 0);
      setMatchedTotal(result.total ?? 0);
      setRepresentatives(result.representatives ?? []);
      setLegacyMismatchCount(result.legacy_date_mismatch_count ?? 0);
      setHasLoaded(true);
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      console.error("Failed to load admin visits:", error);
      setErrorMessage(error instanceof Error ? error.message : "Unable to load field visits");
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [date, dateFrom, dateTo, isAdmin, outcome, representative, search, segment]);

  const visitAnalytics = useMemo(() => buildVisitAnalytics(visits), [visits]);

  const loadErpIntelligence = useCallback(async () => {
    if (!isAdmin || erpInFlight.current) return;
    erpInFlight.current = true;
    setErpError("");
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Authentication required.");
      const response = await fetch("/api/admin/visits/erp-analytics", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      if (!response.ok) throw new Error("ERP intelligence is temporarily unavailable.");
      const result = await response.json();
      setErpSegments(result.segments ?? {});
    } catch {
      setErpError("ERP intelligence is temporarily unavailable. Retry when ready.");
    } finally {
      erpInFlight.current = false;
    }
  }, [isAdmin]);

  useEffect(() => { if (!isAdmin || analyticsMode !== "erp" || erpSegments || erpError) return; queueMicrotask(() => void loadErpIntelligence()); }, [analyticsMode, erpError, erpSegments, isAdmin, loadErpIntelligence]);

  useEffect(() => {
    queueMicrotask(() => void loadData(1));
  }, [loadData]);

  useEffect(() => {
    if (!isAdmin) return;
    const scheduleRefresh = () => {
      if (realtimeTimer.current) clearTimeout(realtimeTimer.current);
      setErpSegments(null);
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
    <div className="app-page min-w-0 crm-workspace">
      <header className="workspace-heading"><div><h1>Visits overview</h1><p>Confirmed field records · India check-in dates</p></div><Button size="sm" variant="outline" icon={<Download size={14} />} onClick={handleExport} isLoading={exporting}>Export to Excel</Button></header>
      <section aria-label="Visit filters" className="space-y-2">
        <div className="grid min-w-0 gap-3 text-xs text-[var(--text-secondary)] sm:grid-cols-3 [&_label]:grid [&_label]:min-w-0 [&_label]:gap-1"><label>Search visits<input aria-label="Search visits" className="field-control min-w-0" placeholder="Business, representative, or notes" value={search} onChange={(event) => { setPage(1); setSearch(event.target.value); }} /></label><label>Representative
        <select aria-label="Representative" className="field-control min-w-0" value={representative} onChange={(event) => { setPage(1); setRepresentative(event.target.value); }}>
          <option value="ALL">All representatives</option>
          {representatives.map((user) => <option key={user.user_id} value={user.user_id}>{user.name}{user.email ? ` (${user.email})` : ""}{user.is_active ? "" : " — inactive"}{user.historical_only ? " — historical" : ""}</option>)}
        </select></label><label>Outcome
        <select aria-label="Outcome" className="field-control min-w-0" value={outcome} onChange={(event) => { setPage(1); setOutcome(event.target.value); }}>
          <option value="ALL">All outcomes</option>
          {["registered", "installed", "interested", "follow_up", "payment_follow_up", "payment_done", "not_interested"].map((value) => <option key={value} value={value}>{getOutcomeLabel(value)}</option>)}
        </select></label></div>
        <details><summary className="cursor-pointer text-sm">Date and segment filters</summary><div className="grid min-w-0 gap-3 text-xs text-[var(--text-secondary)] sm:grid-cols-3 [&_label]:grid [&_label]:min-w-0 [&_label]:gap-1"><label>Visit date<input aria-label="Visit date" type="date" className="field-control min-w-0" value={date} onChange={(event) => { setPage(1); setDate(event.target.value); }} /></label><label>From date<input aria-label="Date From" type="date" className="field-control min-w-0" value={dateFrom} onChange={(event) => { setPage(1); setDate(""); setDateFrom(event.target.value); }} /></label><label>To date<input aria-label="Date To" type="date" className="field-control min-w-0" value={dateTo} onChange={(event) => { setPage(1); setDate(""); setDateTo(event.target.value); }} /></label><label>Segment
        <select aria-label="Segment" className="field-control min-w-0" value={segment} onChange={(event) => { setPage(1); setSegment(event.target.value); }}>
          <option value="ALL">All segments</option><option value="Retailer">Retailer</option><option value="Distributor">Distributor</option>
        </select></label></div><div className="mt-2 flex gap-2"><Button size="sm" variant="outline" onClick={() => { setDate(getCurrentISTDate()); setPage(1); }}>Today</Button><Button size="sm" variant="outline" onClick={() => { setDate(""); setDateFrom(""); setDateTo(""); setPage(1); }}>All dates</Button></div></details>
      </section>
      {legacyMismatchCount > 0 && <div role="status" className="alert-panel alert-panel--warning">Included {legacyMismatchCount} confirmed visits whose stored date differs from their India check-in date.</div>}
      {errorMessage && <div role="alert" className="alert-panel alert-panel--danger">{errorMessage} {hasLoaded && <span>The last confirmed records and their applied scope remain visible.</span>} <Button size="sm" variant="outline" onClick={() => void loadData(page)}>Refresh</Button></div>}
      <p className="text-xs text-[var(--text-secondary)]" aria-live="polite">{hasLoaded ? `Applied: ${appliedScope} · Loaded page ${appliedPage} · ${visits.length} of ${matchedTotal} matching visits` : "Loading confirmed visits…"}{loading && hasLoaded ? " · Refreshing…" : ""}</p>
      <div className="workspace-columns">
        <section className="workspace-register" data-workspace-register tabIndex={-1} aria-label="Confirmed visit history">
          <header className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-4 py-2"><h2 className="text-base font-semibold">Visit register</h2><Button size="sm" variant="ghost" onClick={() => void loadData(page)}>Refresh</Button></header>
          <ol className="divide-y divide-[var(--border-subtle)]">{visits.map((visit) => <li key={visit.visit_id} className="workspace-task-row" data-selected={selected?.visit.visit_id === visit.visit_id}>
            <div className="min-w-0 flex-1"><button type="button" className="min-h-11 text-left text-sm font-semibold" aria-pressed={selected?.visit.visit_id === visit.visit_id} onClick={(event) => { visitTrigger.current = event.currentTarget; setSelected({ visit, scope: `${appliedScope} · Page ${appliedPage}` }); }}>{visit.leads?.business_name?.trim() || visit.lead_id?.trim() || "Unavailable business"}</button><p className="text-xs text-[var(--text-secondary)]">{visit.users?.name || "Unknown representative"} · {visit.segment_type} · {new Date(visit.check_in_time).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })} IST</p></div>
            <Chip variant={getAdminOutcomeVariant(visit.visit_outcome)} size="sm">{getAdminOutcomeLabel(visit.visit_outcome)}</Chip>
          </li>)}</ol>
          {!visits.length && <div className="p-4 text-sm"><p>{loading ? "Loading visits…" : "No confirmed visits match these filters."}</p><Button size="sm" variant="outline" onClick={() => { setDate(""); setDateFrom(""); setDateTo(""); setSearch(""); setRepresentative("ALL"); setSegment("ALL"); setOutcome("ALL"); }}>Clear filters</Button></div>}
          <footer className="flex items-center justify-between border-t border-[var(--border-subtle)] p-3"><span className="text-xs">Loaded page {appliedPage}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1 || loading} onClick={() => void loadData(page - 1)}>Previous</Button><Button size="sm" variant="outline" disabled={!hasMore || loading} onClick={() => void loadData(page + 1)}>Next</Button></div></footer>
        </section>
        <ContextRail open={Boolean(selected)} title={selected?.visit.leads?.business_name || selected?.visit.lead_id || "Visit detail"} description={selected ? `${selected.visit.segment_type} · ${getAdminOutcomeLabel(selected.visit.visit_outcome)}` : "Select a visit"} onClose={() => setSelected(null)} returnFocus={visitTrigger}>
          {selected && <VisitDetail key={selected.visit.visit_id} visit={selected.visit} scope={selected.scope} />}
        </ContextRail>
      </div>
      <Tabs value={analyticsMode} onValueChange={(value) => setAnalyticsMode(value as "activity" | "erp")} activationMode="manual">
        <TabsList aria-label="Visit analytics"><TabsTrigger value="activity">Visit Activity</TabsTrigger><TabsTrigger value="erp">ERP Intelligence</TabsTrigger></TabsList>
        <TabsContent value="activity">{analyticsMode === "activity" && hasLoaded && <VisitsIntelligence model={visitAnalytics} matchedTotal={matchedTotal} page={appliedPage} onOutcome={(key) => { setOutcome(key); setPage(1); }} />}</TabsContent>
      <TabsContent value="erp" className="order-3 space-y-4 sm:order-2">
        {analyticsMode === "erp" && <>
          <p className="text-sm leading-5 text-[var(--text-secondary)]">Current ERP footprint counts unique businesses across confirmed visits and Admin baselines. Visit filters above apply to the register and activity view, not this footprint.</p>
          {erpSegments ? <FieldVisitErpIntelligence segments={erpSegments} /> : erpError ? <div role="alert" className="alert-panel alert-panel--danger">{erpError} <Button size="sm" variant="outline" onClick={() => void loadErpIntelligence()}>Retry</Button></div> : <AnalyticsSkeleton label="Loading ERP intelligence" />}
          <Button size="sm" variant="outline" className="min-h-11" onClick={() => setManageCurrentErpOpen((open) => !open)}>{manageCurrentErpOpen ? "Close Current ERP" : "Manage Current ERP"}</Button>
          {manageCurrentErpOpen && <CurrentErpBaselineEditor onSaved={() => { setErpSegments(null); setErpError(""); void loadErpIntelligence(); }} />}
        </>}
      </TabsContent>

      </Tabs>
      <details className="workspace-disclosure"><summary>Global visit context and representative directory</summary><p className="text-xs">{appliedGlobalScope}. Totals exclude date and search filters. The directory is a separate population, including historical representatives.</p><dl className="workspace-counts"><div><dt>All-time visits</dt><dd>{hasLoaded ? allTimeTotal.toLocaleString("en-IN") : "—"}</dd></div><div><dt>Visits today · India</dt><dd>{hasLoaded ? todayTotal.toLocaleString("en-IN") : "—"}</dd></div><div><dt>Representative directory</dt><dd>{hasLoaded ? representatives.length : "—"}</dd></div></dl></details>
    </div>
  );
}

function VisitDetail({ visit, scope }: { visit: AdminVisit; scope: string }) {
  return <>
    <p className="text-xs text-[var(--text-secondary)]">Selected record snapshot from: {scope}. Changing register filters does not change this selection.</p>
    <dl className="space-y-3">
      <div><dt>Representative</dt><dd>{visit.users?.name || "Unknown"} · {visit.users?.email || "Email unavailable"}</dd></div>
      <div><dt>Person met</dt><dd>{visit.person_met || "Unavailable"}</dd></div>
      <div><dt>{visit.segment_type === "Retailer" ? "Area" : "Address"}</dt><dd className="whitespace-pre-wrap">{visit.address?.trim() || "Legacy visit — address was not captured"}</dd></div>
      <div><dt>Pincode</dt><dd>{visit.pincode?.trim() || "Not captured"}</dd></div>
      <div><dt>ERP at visit</dt><dd>{visit.erp_usage_state === "erp" ? visit.erp_name || "Not captured" : visit.erp_usage_state === "none" ? "None" : "Not captured"}</dd></div>
      <div><dt>Follow-up date</dt><dd>{visit.follow_up_date || "None recorded"}</dd></div>
      <div><dt>Notes</dt><dd className="whitespace-pre-wrap">{visit.visit_notes || "None recorded"}</dd></div>
      <div><dt>Sync</dt><dd>{visit.sync_status || "Confirmed"}</dd></div>
      <div><dt>GPS</dt><dd>{visit.check_in_lat != null && visit.check_in_lng != null ? <a target="_blank" rel="noreferrer" className="underline" href={`https://www.google.com/maps?q=${visit.check_in_lat},${visit.check_in_lng}`}>{visit.check_in_lat}, {visit.check_in_lng} · Open Location</a> : "Not captured"}</dd></div>
    </dl>
    {visit.selfie_status === "AVAILABLE" ? <EvidenceButton visitId={visit.visit_id} /> : <p>{visit.selfie_status === "PURGED" ? "Selfie captured · Expired after 5-day retention" : "Evidence pending"}</p>}
  </>;
}

function EvidenceButton({ visitId }: { visitId: string }) {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const openEvidence = async () => {
    setLoading(true); setError("");
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error("Sign in again to view evidence.");
      const response = await fetch(`/api/admin/visits/evidence?visit_id=${encodeURIComponent(visitId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("Evidence is unavailable. Please retry.");
      const result = await response.json();
      window.open(result.url, "_blank", "noopener,noreferrer");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Evidence could not be opened."); } finally {
      setLoading(false);
    }
  };
  return <div><Button size="sm" variant="outline" isLoading={loading} onClick={openEvidence}>View Selfie</Button>{error && <p role="alert">{error}</p>}</div>;
}
