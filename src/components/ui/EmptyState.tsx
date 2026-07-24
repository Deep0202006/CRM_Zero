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
}

export function EmptyState({
  title = "No records found",
  description = "There are no items to display in this queue right now.",
  icon = <FolderOpen size={36} className="text-[var(--text-muted)]" />,
  actionLabel,
  onAction,
  className = "",
}: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center text-center p-8 bg-[var(--surface-primary)] border border-[var(--border-subtle)] rounded-[var(--radius-xl)] space-y-3 ${className}`}>
      <div className="p-3 bg-[var(--surface-secondary)] rounded-full mb-1">
        {icon}
      </div>
      <h4 className="text-sm font-black text-[var(--text-primary)]">{title}</h4>
      <p className="text-xs text-[var(--text-muted)] max-w-sm font-medium leading-relaxed">{description}</p>
      {actionLabel && onAction && (
        <Button size="sm" onClick={onAction} className="mt-2">
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
