"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Building2,
  Calendar,
  CheckCircle2,
  ChevronRight,
  Mail,
  MapPin,
  Phone,
  User,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";

export interface RecordInspectorData {
  id: string;
  title: string;
  subtitle?: string;
  type: "lead" | "target" | "query" | "task";
  status: string;
  statusVariant?: "success" | "warning" | "danger" | "info" | "neutral" | "brand" | "pending";
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  owner?: string;
  createdAt?: string;
  details?: Record<string, string | number | boolean | null | undefined>;
}

interface RecordInspectorProps {
  record: RecordInspectorData | null;
  onClose: () => void;
  onAction?: (actionName: string, record: RecordInspectorData) => void;
}

export function RecordInspector({ record, onClose, onAction }: RecordInspectorProps) {
  const [tab, setTab] = useState<"overview" | "properties">("overview");
  const recordId = record?.id;
  const panelRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const overviewTabId = useId();
  const propertiesTabId = useId();
  const overviewPanelId = useId();
  const propertiesPanelId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    setTab("overview");
  }, [recordId]);

  useEffect(() => {
    if (!recordId) return;

    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableSelector = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(",");

    const focusCloseButton = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(focusableSelector)
      ).filter((element) => element.offsetParent !== null);

      if (!focusable.length) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusCloseButton);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [recordId]);

  const initials = useMemo(() => {
    if (!record?.title) return "ZD";
    const parts = record.title.trim().split(/\s+/);
    return parts.length > 1
      ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
      : parts[0].slice(0, 2).toUpperCase();
  }, [record?.title]);

  if (!record) return null;

  const properties = Object.entries(record.details || {});

  return (
    <div className="fixed inset-0 z-[var(--z-drawer)]" role="presentation">
      <button type="button" tabIndex={-1} className="absolute inset-0 bg-[var(--surface-overlay)] backdrop-blur-[4px]" onClick={onClose} aria-label="Close record inspector" />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="absolute inset-y-0 right-0 flex w-full flex-col border-l border-[var(--border-default)] bg-[var(--surface-primary)] shadow-[var(--shadow-dialog)] animate-[zd-dialog-in_var(--motion-overlay)_var(--ease-enter)_both] sm:w-[460px]"
      >
        <header className="border-b border-[var(--border-subtle)] px-5 pb-4 pt-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-[13px] bg-[var(--brand-100)] text-[12px] font-bold text-[var(--brand-800)]">{initials}</span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 id={titleId} className="truncate text-[17px] font-semibold tracking-[-0.025em] text-[var(--text-primary)]">{record.title}</h2>
                  <Chip variant={record.statusVariant || "brand"} size="sm" dot>{record.status}</Chip>
                </div>
                {record.subtitle && <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-[var(--text-muted)]">{record.subtitle}</p>}
              </div>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-md)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
              aria-label="Close inspector"
            >
              <X size={18} />
            </button>
          </div>

          <div className="mt-5 flex gap-1 border-b border-[var(--border-subtle)]" role="tablist" aria-label="Record detail sections">
            {(["overview", "properties"] as const).map((item) => (
              <button
                key={item}
                id={item === "overview" ? overviewTabId : propertiesTabId}
                type="button"
                role="tab"
                aria-selected={tab === item}
                aria-controls={item === "overview" ? overviewPanelId : propertiesPanelId}
                tabIndex={tab === item ? 0 : -1}
                onClick={() => setTab(item)}
                className={`relative px-3 py-2.5 text-[12px] font-semibold capitalize transition-colors ${
                  tab === item ? "text-[var(--brand-700)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                }`}
              >
                {item}
                {tab === item && <span className="absolute inset-x-2 bottom-[-1px] h-0.5 rounded-full bg-[var(--brand-500)]" />}
              </button>
            ))}
          </div>
        </header>

        <div
          id={tab === "overview" ? overviewPanelId : propertiesPanelId}
          role="tabpanel"
          aria-labelledby={tab === "overview" ? overviewTabId : propertiesTabId}
          className="min-h-0 flex-1 overflow-y-auto px-5 py-5"
        >
          {tab === "overview" ? (
            <div className="space-y-6">
              <section>
                <p className="section-kicker">Contact and ownership</p>
                <div className="mt-3 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)]">
                  {record.phone && (
                    <a href={`tel:${record.phone}`} className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-3.5 transition hover:bg-[var(--surface-hover)]">
                      <span className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] bg-[var(--status-success-soft)] text-[var(--status-success)]"><Phone size={15} /></span>
                      <span className="min-w-0 flex-1"><span className="block text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">Phone</span><span className="mt-0.5 block truncate text-[12px] font-semibold text-[var(--text-primary)]">{record.phone}</span></span>
                      <ChevronRight size={15} className="text-[var(--text-disabled)]" />
                    </a>
                  )}
                  {record.email && (
                    <a href={`mailto:${record.email}`} className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-3.5 transition hover:bg-[var(--surface-hover)]">
                      <span className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] bg-[var(--status-info-soft)] text-[var(--status-info)]"><Mail size={15} /></span>
                      <span className="min-w-0 flex-1"><span className="block text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">Email</span><span className="mt-0.5 block truncate text-[12px] font-semibold text-[var(--text-primary)]">{record.email}</span></span>
                      <ChevronRight size={15} className="text-[var(--text-disabled)]" />
                    </a>
                  )}
                  {(record.address || record.city) && (
                    <div className="flex items-start gap-3 border-b border-[var(--border-subtle)] px-4 py-3.5 last:border-0">
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--radius-md)] bg-[var(--status-warning-soft)] text-[var(--status-warning)]"><MapPin size={15} /></span>
                      <span className="min-w-0 flex-1"><span className="block text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">Location</span><span className="mt-0.5 block text-[12px] leading-5 text-[var(--text-primary)]">{[record.address, record.city].filter(Boolean).join(", ")}</span></span>
                    </div>
                  )}
                  {record.owner && (
                    <div className="flex items-center gap-3 border-b border-[var(--border-subtle)] px-4 py-3.5 last:border-0">
                      <span className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] bg-[var(--brand-50)] text-[var(--brand-700)]"><User size={15} /></span>
                      <span className="min-w-0 flex-1"><span className="block text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">Owner</span><span className="mt-0.5 block truncate text-[12px] font-semibold text-[var(--text-primary)]">{record.owner}</span></span>
                    </div>
                  )}
                </div>
              </section>

              <section>
                <p className="section-kicker">Record context</p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-4">
                    <Building2 size={16} className="text-[var(--brand-600)]" />
                    <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">Record type</p>
                    <p className="mt-1 text-[13px] font-semibold capitalize text-[var(--text-primary)]">{record.type}</p>
                  </div>
                  <div className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-4">
                    <Calendar size={16} className="text-[var(--status-info)]" />
                    <p className="mt-3 text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-muted)]">Created</p>
                    <p className="mt-1 text-[13px] font-semibold text-[var(--text-primary)]">{record.createdAt ? new Date(record.createdAt).toLocaleDateString() : "Not available"}</p>
                  </div>
                </div>
              </section>
            </div>
          ) : (
            <section>
              <div className="flex items-center justify-between gap-3">
                <div><p className="section-kicker">Record properties</p><p className="mt-1 text-[12px] text-[var(--text-muted)]">Verified values attached to this record.</p></div>
                <Chip variant="neutral" size="sm">{properties.length} fields</Chip>
              </div>
              <dl className="mt-4 overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)]">
                {properties.length ? properties.map(([key, value]) => (
                  <div key={key} className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-4 border-b border-[var(--border-subtle)] px-4 py-3.5 last:border-0">
                    <dt className="text-[11px] font-medium capitalize text-[var(--text-muted)]">{key.replace(/_/g, " ")}</dt>
                    <dd className="break-words text-right text-[12px] font-semibold text-[var(--text-primary)]">{String(value ?? "Not available")}</dd>
                  </div>
                )) : (
                  <div className="px-4 py-8 text-center text-[12px] text-[var(--text-muted)]">No additional properties are available.</div>
                )}
              </dl>
            </section>
          )}
        </div>

        <footer className="border-t border-[var(--border-subtle)] bg-[var(--surface-secondary)] p-4">
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} className="flex-1">Close</Button>
            {onAction && (
              <Button onClick={() => onAction("complete", record)} className="flex-1" icon={<CheckCircle2 size={15} />}>Continue workflow</Button>
            )}
          </div>
        </footer>
      </aside>
    </div>
  );
}
