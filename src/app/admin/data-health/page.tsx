"use client";

import { useCallback, useEffect, useState } from "react";
import { liveQuery } from "dexie";
import { Activity, AlertCircle, CheckCircle2, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { db, getUnsynchronizedWorkCounts, processSyncQueue, type SyncQueueItem } from "@/lib/db";
import { supabase } from "@/lib/supabaseClient";
import { PageHeader } from "@/components/ui/PageHeader";
import { MetricCard } from "@/components/ui/MetricCard";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

interface ServerHealth {
  latest_call_at: string | null;
  latest_query_at: string | null;
  latest_mapping_at: string | null;
  latest_task_at: string | null;
  latest_target_at: string | null;
  latest_visit_at: string | null;
  latest_kpi_event_at: string | null;
  receipt_count: number;
  source_event_difference: Record<string, number>;
  generated_at: string;
}

export default function DataHealthPage() {
  const { currentUser, isAdmin } = useAuth();
  const [queue, setQueue] = useState<SyncQueueItem[]>([]);
  const [server, setServer] = useState<ServerHealth | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  const [bootstrapCount, setBootstrapCount] = useState(0);

  useEffect(() => {
    const subscription = liveQuery(() => db.sync_queue.toArray()).subscribe(setQueue);
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    if (currentUser) {
      setBootstrapCount(Object.keys(localStorage).filter((key) => key.startsWith(`bootstrap:${currentUser.user_id}:`)).length);
    }
    return () => {
      subscription.unsubscribe();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [currentUser]);

  const loadServer = useCallback(async () => {
    if (!isAdmin) return;
    const { data, error: rpcError } = await supabase.rpc("get_admin_data_health_v1");
    if (rpcError) {
      setError("Server health metadata is unavailable. Apply and verify migration 030.");
      return;
    }
    setServer(data as ServerHealth);
    setError(null);
  }, [isAdmin]);

  useEffect(() => { void loadServer(); }, [loadServer]);

  const retry = async () => {
    const retryable = queue.filter((item) => item.status === "retry_wait");
    await db.transaction("rw", db.sync_queue, async () => {
      for (const item of retryable) {
        if (item.id) await db.sync_queue.update(item.id, { status: "pending", next_retry_at: null });
      }
    });
    await processSyncQueue();
    await getUnsynchronizedWorkCounts();
    await loadServer();
  };

  if (!isAdmin) {
    return <div className="app-page"><PageHeader eyebrow="Security" title="Access Denied" description="Administrator access is required." /></div>;
  }

  const pending = queue.filter((item) => !item.status || item.status === "pending" || item.status === "syncing").length;
  const retryWait = queue.filter((item) => item.status === "retry_wait").length;
  const permanent = queue.filter((item) => item.status === "permanent_failure").length;
  return (
    <div className="app-page">
      <PageHeader
        eyebrow="Operations"
        icon={<Activity size={18} />}
        title="Data Health"
        description="Safe synchronization, bootstrap, and reporting metadata for this device and server."
        actions={<Button size="sm" variant="outline" icon={<RefreshCw size={14} />} onClick={retry}>Retry pending sync</Button>}
      />
      {error && <div className="alert-panel alert-panel--danger" role="alert"><AlertCircle size={16} /><span>{error}</span></div>}
      <div className="metric-grid">
        <MetricCard label="Pending" value={pending} icon={<RefreshCw size={17} />} />
        <MetricCard label="Retry wait" value={retryWait} icon={<AlertCircle size={17} />} tone="warning" />
        <MetricCard label="Permanent failures" value={permanent} icon={<AlertCircle size={17} />} tone="danger" />
        <MetricCard label="Connection" value={online ? "Online" : "Offline"} icon={online ? <Wifi size={17} /> : <WifiOff size={17} />} tone={online ? "success" : "warning"} />
      </div>
      <section className="surface-panel p-5">
        <h2 className="section-title">Current device</h2>
        <p className="mt-2 text-[12px] text-[var(--text-muted)]">Bootstrap sources completed: {bootstrapCount}</p>
        {queue.length === 0 ? (
          <EmptyState icon={<CheckCircle2 size={20} />} title="No unsynchronized operations" description="This device has no pending or failed business commands." />
        ) : (
          <div className="mt-4 space-y-2">
            {queue.map((item) => (
              <div key={item.id} className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-3 text-[12px]">
                <span className="font-semibold">{item.entity_type || item.table_name}</span>
                <span className="ml-2 text-[var(--text-muted)]">{item.status || "pending"} · attempt {item.retry_count ?? 0}</span>
                {item.last_error_code && <span className="ml-2 text-[var(--status-danger)]">{item.last_error_code}</span>}
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="surface-panel p-5">
        <h2 className="section-title">Server health</h2>
        {server ? (
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            {Object.entries(server).filter(([key]) => key.startsWith("latest_")).map(([key, value]) => (
              <div key={key}><dt className="text-[11px] text-[var(--text-muted)]">{key.replaceAll("_", " ")}</dt><dd className="text-[12px] font-semibold">{value ? new Date(String(value)).toLocaleString() : "No confirmed record"}</dd></div>
            ))}
          </dl>
        ) : <p className="mt-2 text-[12px] text-[var(--text-muted)]">Loading server metadata…</p>}
      </section>
    </div>
  );
}
