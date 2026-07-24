"use client";

import React from "react";
import { PageHeader } from "@/components/ui/PageHeader";

export interface DashboardPageTemplateProps {
  headerTitle: React.ReactNode;
  headerSubtitle?: string;
  headerEyebrow?: React.ReactNode;
  headerIcon?: React.ReactNode;
  primaryAction?: React.ReactNode;
  headerMeta?: React.ReactNode;
  attentionQueue?: React.ReactNode;
  kpis?: React.ReactNode;
  mainContent: React.ReactNode;
  contextPanel?: React.ReactNode;
  className?: string;
}

export function DashboardPageTemplate({
  headerTitle,
  headerSubtitle,
  headerEyebrow = "Operational overview",
  headerIcon,
  primaryAction,
  headerMeta,
  attentionQueue,
  kpis,
  mainContent,
  contextPanel,
  className = "",
}: DashboardPageTemplateProps) {
  return (
    <div className={`app-page ${className}`}>
      <PageHeader
        title={headerTitle}
        description={headerSubtitle}
        eyebrow={headerEyebrow}
        icon={headerIcon}
        actions={primaryAction}
        meta={headerMeta}
      />

      {attentionQueue && <section aria-label="Attention queue">{attentionQueue}</section>}
      {kpis && <section aria-label="Operational metrics">{kpis}</section>}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12 xl:gap-6">
        <div className={contextPanel ? "space-y-5 xl:col-span-8" : "space-y-5 xl:col-span-12"}>{mainContent}</div>
        {contextPanel && <aside className="space-y-5 xl:col-span-4">{contextPanel}</aside>}
      </div>
    </div>
  );
}
