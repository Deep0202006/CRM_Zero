"use client";

import React from "react";
import { X, User, Phone, MapPin, Building, Calendar, CheckCircle2, Clock, Mail, Tag, ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/Card";
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
  if (!record) return null;

  return (
    <div className="fixed inset-y-0 right-0 w-full sm:w-[380px] bg-[var(--surface-primary)] border-l border-[var(--border-subtle)] shadow-[var(--shadow-popover)] z-[var(--z-drawer)] flex flex-col justify-between transition-all duration-200 animate-in slide-in-from-right">
      {/* Header */}
      <div className="p-4 border-b border-[var(--border-subtle)] flex items-center justify-between bg-[var(--surface-secondary)]">
        <div className="flex items-center gap-2 min-w-0">
          <Building size={18} className="text-[var(--brand-500)] shrink-0" />
          <div className="truncate leading-tight">
            <h3 className="text-sm font-black text-[var(--text-primary)] truncate">{record.title}</h3>
            {record.subtitle && (
              <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-wider truncate">
                {record.subtitle}
              </p>
            )}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} className="p-1 px-2" icon={<X size={16} />} />
      </div>

      {/* Body Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Status Strip */}
        <div className="flex items-center justify-between p-3 bg-[var(--surface-canvas)] rounded-[var(--radius-md)] border border-[var(--border-subtle)]">
          <span className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest">
            Current Status
          </span>
          <Chip variant={record.statusVariant || "brand"} size="sm">
            {record.status}
          </Chip>
        </div>

        {/* Identity & Metadata Section */}
        <div className="space-y-2.5">
          <h4 className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest">
            Contact & Identity Vector
          </h4>

          {record.phone && (
            <div className="flex items-center gap-2 text-xs text-[var(--text-primary)]">
              <Phone size={14} className="text-[var(--text-muted)] shrink-0" />
              <span className="font-semibold">{record.phone}</span>
            </div>
          )}

          {record.email && (
            <div className="flex items-center gap-2 text-xs text-[var(--text-primary)]">
              <Mail size={14} className="text-[var(--text-muted)] shrink-0" />
              <span className="font-semibold truncate">{record.email}</span>
            </div>
          )}

          {record.address && (
            <div className="flex items-start gap-2 text-xs text-[var(--text-primary)]">
              <MapPin size={14} className="text-[var(--text-muted)] shrink-0 mt-0.5" />
              <span className="font-medium text-[var(--text-secondary)]">
                {record.address} {record.city ? `, ${record.city}` : ""}
              </span>
            </div>
          )}

          {record.owner && (
            <div className="flex items-center gap-2 text-xs text-[var(--text-primary)]">
              <User size={14} className="text-[var(--text-muted)] shrink-0" />
              <span className="font-semibold text-[var(--text-secondary)]">Owner: {record.owner}</span>
            </div>
          )}

          {record.createdAt && (
            <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)] font-mono">
              <Calendar size={14} className="shrink-0" />
              <span>Created: {new Date(record.createdAt).toLocaleDateString()}</span>
            </div>
          )}
        </div>

        {/* Custom Property Grid */}
        {record.details && Object.keys(record.details).length > 0 && (
          <div className="space-y-2 pt-2 border-t border-[var(--border-subtle)]">
            <h4 className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest">
              Record Properties
            </h4>
            <div className="grid grid-cols-1 gap-2">
              {Object.entries(record.details).map(([key, value]) => (
                <div key={key} className="flex justify-between items-center text-xs p-2 bg-[var(--surface-secondary)] rounded-[var(--radius-sm)]">
                  <span className="font-bold text-[var(--text-muted)] capitalize">{key.replace(/_/g, " ")}</span>
                  <span className="font-mono text-[var(--text-primary)] font-semibold truncate max-w-[180px]">
                    {String(value ?? "N/A")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer Actions */}
      <div className="p-4 border-t border-[var(--border-subtle)] bg-[var(--surface-secondary)] space-y-2">
        {onAction && (
          <Button
            size="sm"
            className="w-full"
            onClick={() => onAction("complete", record)}
            icon={<CheckCircle2 size={14} />}
          >
            Done ✓
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={onClose}
        >
          Close Inspector
        </Button>
      </div>
    </div>
  );
}
