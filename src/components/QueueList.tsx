"use client";

import React from "react";
import { Clock, RefreshCw } from "lucide-react";
import { Chip } from "@/components/ui/Chip";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";

export interface QueueItem {
  id: string;
  primaryNode: React.ReactNode;
  statusText: string;
  statusColorClasses?: string;
  statusVariant?: "success" | "warning" | "danger" | "info" | "neutral" | "brand" | "pending";
  timestamp: string;
  actions?: React.ReactNode;
}

interface QueueListProps {
  title: string;
  icon?: React.ReactNode;
  items: QueueItem[];
  emptyMessage?: string;
  onRefresh?: () => void;
  className?: string;
  countDescription?: React.ReactNode;
}

export function QueueList({
  title,
  icon = <Clock size={16} />,
  items,
  emptyMessage = "No items found.",
  onRefresh,
  className = "",
  countDescription,
}: QueueListProps) {
  return (
    <section className={`flex h-full max-h-[720px] min-h-[360px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--surface-primary)] shadow-[var(--shadow-raised)] ${className}`}>
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-[var(--border-subtle)] px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-[var(--radius-md)] bg-[var(--brand-50)] text-[var(--brand-700)]">{icon}</span>
            <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-[var(--text-primary)]">{title}</h2>
          </div>
          <p className="ml-10 mt-0.5 text-[10px] font-medium text-[var(--text-muted)]">
            {countDescription ?? <>{items.length} {items.length === 1 ? "record" : "records"}</>}
          </p>
        </div>
        {onRefresh && (
          <Button variant="ghost" size="sm" onClick={onRefresh} title="Refresh queue" aria-label="Refresh queue" icon={<RefreshCw size={15} />} />
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {items.length === 0 ? (
          <EmptyState title="Queue is clear" description={emptyMessage} className="min-h-[280px] border-0 bg-[var(--surface-secondary)]" />
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <article
                key={item.id}
                className="group rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--surface-primary)] p-3.5 transition-[border-color,background-color,transform] hover:-translate-y-px hover:border-[var(--brand-200)] hover:bg-[var(--surface-hover)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">{item.primaryNode}</div>
                  <Chip variant={item.statusVariant || (item.statusText === "Completed" ? "success" : "warning")} size="sm" dot>
                    {item.statusText}
                  </Chip>
                </div>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-2.5">
                  <span className="text-[10px] font-medium text-[var(--text-muted)]">{item.timestamp}</span>
                  {item.actions && <div className="flex items-center gap-2">{item.actions}</div>}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
