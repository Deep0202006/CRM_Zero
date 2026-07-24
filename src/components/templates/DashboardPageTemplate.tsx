"use client";

import React from "react";

export interface DashboardPageTemplateProps {
  headerTitle: React.ReactNode;
  headerSubtitle?: string;
  primaryAction?: React.ReactNode;
  attentionQueue?: React.ReactNode;
  kpis?: React.ReactNode;
  mainContent: React.ReactNode;
  contextPanel?: React.ReactNode;
  className?: string;
}

export function DashboardPageTemplate({
  headerTitle,
  headerSubtitle,
  primaryAction,
  attentionQueue,
  kpis,
  mainContent,
  contextPanel,
  className = "",
}: DashboardPageTemplateProps) {
  return (
    <div className={`space-y-6 w-full max-w-7xl mx-auto ${className}`}>
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-[var(--text-primary)] leading-tight">
            {headerTitle}
          </h1>
          {headerSubtitle && (
            <p className="text-xs text-[var(--text-muted)] font-bold tracking-wider uppercase mt-0.5">
              {headerSubtitle}
            </p>
          )}
        </div>
        {primaryAction && <div className="shrink-0">{primaryAction}</div>}
      </div>

      {/* Attention Queue (Upper Left / Top Banner) */}
      {attentionQueue && <div>{attentionQueue}</div>}

      {/* Operational Metrics (Max 4 KPI Cards) */}
      {kpis && <div>{kpis}</div>}

      {/* Main Grid: 8-col Main Operational Area / 4-col Context Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className={contextPanel ? "lg:col-span-8 space-y-6" : "lg:col-span-12 space-y-6"}>
          {mainContent}
        </div>
        {contextPanel && <div className="lg:col-span-4 space-y-6">{contextPanel}</div>}
      </div>
    </div>
  );
}
