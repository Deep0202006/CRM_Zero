"use client";

import React from "react";

export interface ListPageTemplateProps {
  title: React.ReactNode;
  subtitle?: string;
  primaryAction?: React.ReactNode;
  toolbar?: React.ReactNode;
  activeFilterChips?: React.ReactNode;
  children: React.ReactNode;
  pagination?: React.ReactNode;
  className?: string;
}

export function ListPageTemplate({
  title,
  subtitle,
  primaryAction,
  toolbar,
  activeFilterChips,
  children,
  pagination,
  className = "",
}: ListPageTemplateProps) {
  return (
    <div className={`space-y-6 w-full max-w-7xl mx-auto ${className}`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-[var(--text-primary)]">{title}</h1>
          {subtitle && (
            <p className="text-xs text-[var(--text-muted)] font-bold tracking-wider uppercase mt-0.5">
              {subtitle}
            </p>
          )}
        </div>
        {primaryAction && <div className="shrink-0">{primaryAction}</div>}
      </div>

      {/* Toolbar & Filter Chips */}
      {(toolbar || activeFilterChips) && (
        <div className="space-y-3">
          {toolbar && <div className="p-3 bg-[var(--surface-primary)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)]">{toolbar}</div>}
          {activeFilterChips && <div className="flex items-center gap-2 flex-wrap">{activeFilterChips}</div>}
        </div>
      )}

      {/* Primary Data List / Table Container */}
      <div className="w-full overflow-hidden">{children}</div>

      {/* Pagination Footer */}
      {pagination && <div className="flex items-center justify-between pt-2">{pagination}</div>}
    </div>
  );
}
