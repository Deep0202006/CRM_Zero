import React from "react";
import { Clock, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Button } from "@/components/ui/Button";

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
}

export function QueueList({
  title,
  icon = <Clock size={16} className="text-[var(--brand-500)]" />,
  items,
  emptyMessage = "No items found.",
  onRefresh,
}: QueueListProps) {
  return (
    <Card className="lg:col-span-3 space-y-4 flex flex-col h-full max-h-[650px]">
      <div className="flex items-center justify-between shrink-0 border-b border-[var(--border-subtle)] pb-3">
        <h3 className="text-sm font-black text-[var(--text-primary)] flex items-center gap-2">
          {icon} {title}
        </h3>
        {onRefresh && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            className="p-1 px-2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            title="Refresh Queue"
            icon={<RefreshCw size={14} />}
          />
        )}
      </div>

      <div className="space-y-3 overflow-y-auto pr-1 flex-1 pb-2">
        {items.length === 0 && (
          <p className="text-xs italic text-[var(--text-muted)] text-center py-12 font-semibold">
            {emptyMessage}
          </p>
        )}
        {items.map((item) => (
          <div
            key={item.id}
            className="p-3.5 bg-[var(--surface-secondary)] rounded-[var(--radius-md)] border border-[var(--border-subtle)] space-y-2.5 hover:border-[var(--border-default)] transition-all"
          >
            <div className="flex justify-between items-start gap-2">
              <div className="flex-1 min-w-0">{item.primaryNode}</div>
              <Chip variant={item.statusVariant || (item.statusText === "Completed" ? "success" : "warning")} size="sm">
                {item.statusText}
              </Chip>
            </div>
            <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)] font-semibold border-t border-[var(--border-subtle)] pt-2">
              <span>{item.timestamp}</span>
              {item.actions && <div className="flex items-center gap-2">{item.actions}</div>}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
