"use client";

import React from "react";
import { FolderOpen } from "lucide-react";
import { Button } from "./Button";

export interface EmptyStateProps {
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
  compact?: boolean;
}

export function EmptyState({
  title = "No records found",
  description = "There are no items to display in this view right now.",
  icon = <FolderOpen size={24} />,
  actionLabel,
  onAction,
  className = "",
  compact = false,
}: EmptyStateProps) {
  return (
    <div className={`flex ${compact ? "min-h-36" : "min-h-56"} flex-col items-center justify-center rounded-[var(--radius-lg)] border border-dashed border-[var(--border-default)] bg-[var(--surface-secondary)] px-6 ${compact ? "py-6" : "py-10"} text-center ${className}`}>
      <div className="mb-4 grid h-12 w-12 place-items-center rounded-[var(--radius-lg)] border border-[var(--brand-100)] bg-[var(--brand-50)] text-[var(--brand-600)]">
        {icon}
      </div>
      <h3 className="text-[15px] font-semibold text-[var(--text-primary)]">{title}</h3>
      <p className="mt-2 max-w-md text-[12px] leading-5 text-[var(--text-muted)]">{description}</p>
      {actionLabel && onAction && <Button size="sm" onClick={onAction} className="mt-5">{actionLabel}</Button>}
    </div>
  );
}
