"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, BarChart3 } from "lucide-react";

export function AnalyticsPanel({
  eyebrow,
  title,
  description,
  action,
  children,
  className = "",
  labelledBy,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  labelledBy: string;
}) {
  return (
    <section className={`analytics-panel ${className}`} aria-labelledby={labelledBy}>
      <header className="analytics-panel__header">
        <div className="min-w-0">
          <p className="section-kicker">{eyebrow}</p>
          <h2 id={labelledBy} className="mt-1 text-[17px] font-semibold tracking-[-0.025em] text-[var(--text-primary)]">{title}</h2>
          <p className="mt-1 max-w-2xl text-[12px] leading-5 text-[var(--text-muted)]">{description}</p>
        </div>
        {action}
      </header>
      <div className="analytics-panel__body">{children}</div>
    </section>
  );
}

export function AnalyticsSkeleton({ label = "Loading visual intelligence" }: { label?: string }) {
  return (
    <section className="analytics-panel min-h-[300px]" aria-label={label} aria-busy="true">
      <div className="analytics-panel__header">
        <div className="w-full space-y-3">
          <div className="skeleton-shimmer h-3 w-28 rounded" />
          <div className="skeleton-shimmer h-5 w-52 rounded" />
          <div className="skeleton-shimmer h-3 w-4/5 rounded" />
        </div>
      </div>
      <div className="grid min-h-[220px] place-items-center p-5">
        <div className="skeleton-shimmer h-40 w-40 rounded-full" />
      </div>
    </section>
  );
}

export function AnalyticsEmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="grid min-h-[220px] place-items-center rounded-[var(--radius-lg)] border border-dashed border-[var(--border-default)] bg-[var(--surface-secondary)] p-6 text-center">
      <div>
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-[var(--radius-md)] bg-[var(--brand-50)] text-[var(--brand-600)]"><BarChart3 size={20} /></span>
        <p className="mt-3 text-[14px] font-semibold text-[var(--text-primary)]">{title}</p>
        <p className="mx-auto mt-1 max-w-sm text-[12px] leading-5 text-[var(--text-muted)]">{description}</p>
      </div>
    </div>
  );
}

class AnalyticsBoundaryImpl extends Component<{ children: ReactNode; fallback?: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Analytics panel rendering failed", { message: error.message, componentStack: info.componentStack });
  }

  render() {
    if (this.state.failed) {
      return this.props.fallback ?? (
        <div className="alert-panel alert-panel--warning" role="status">
          <AlertTriangle size={17} className="mt-0.5 shrink-0" />
          <span>The visual summary is unavailable. Operational cards and actions remain available.</span>
        </div>
      );
    }
    return this.props.children;
  }
}

export function AnalyticsBoundary({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  return <AnalyticsBoundaryImpl fallback={fallback}>{children}</AnalyticsBoundaryImpl>;
}
