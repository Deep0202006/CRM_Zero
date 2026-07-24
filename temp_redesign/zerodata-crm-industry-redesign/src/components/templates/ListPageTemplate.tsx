"use client";

import React from "react";
import { PageHeader } from "@/components/ui/PageHeader";

export interface ListPageTemplateProps {
  title: React.ReactNode;
  subtitle?: string;
  eyebrow?: React.ReactNode;
  icon?: React.ReactNode;
  primaryAction?: React.ReactNode;
  headerMeta?: React.ReactNode;
  toolbar?: React.ReactNode;
  activeFilterChips?: React.ReactNode;
  children: React.ReactNode;
  pagination?: React.ReactNode;
  className?: string;
}

export function ListPageTemplate({
  title,
  subtitle,
  eyebrow = "Workspace",
  icon,
  primaryAction,
  headerMeta,
  toolbar,
  activeFilterChips,
  children,
  pagination,
  className = "",
}: ListPageTemplateProps) {
  return (
    <div className={`app-page ${className}`}>
      <PageHeader title={title} description={subtitle} eyebrow={eyebrow} icon={icon} actions={primaryAction} meta={headerMeta} />

      {(toolbar || activeFilterChips) && (
        <section className="space-y-3" aria-label="List controls">
          {toolbar && <div className="surface-toolbar">{toolbar}</div>}
          {activeFilterChips && <div className="flex flex-wrap items-center gap-2">{activeFilterChips}</div>}
        </section>
      )}

      <section className="min-w-0">{children}</section>
      {pagination && <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border-subtle)] pt-4">{pagination}</footer>}
    </div>
  );
}
