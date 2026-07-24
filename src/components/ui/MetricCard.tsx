"use client";

import React from "react";

interface MetricCardProps {
  label: React.ReactNode;
  value: React.ReactNode;
  icon?: React.ReactNode;
  note?: React.ReactNode;
  trend?: React.ReactNode;
  tone?: "brand" | "neutral" | "success" | "warning" | "danger" | "info";
  className?: string;
}

const toneStyles = {
  brand: "bg-[var(--brand-50)] text-[var(--brand-700)]",
  neutral: "bg-[var(--surface-secondary)] text-[var(--text-secondary)]",
  success: "bg-[var(--status-success-soft)] text-[var(--status-success)]",
  warning: "bg-[var(--status-warning-soft)] text-[var(--status-warning)]",
  danger: "bg-[var(--status-danger-soft)] text-[var(--status-danger)]",
  info: "bg-[var(--status-info-soft)] text-[var(--status-info)]",
};

export function MetricCard({ label, value, icon, note, trend, tone = "brand", className = "" }: MetricCardProps) {
  return (
    <article className={`metric-card flex flex-col justify-between gap-5 ${className}`}>
      <div className="flex items-start justify-between gap-4">
        <span className="metric-card__label">{label}</span>
        {icon && <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-md)] ${toneStyles[tone]}`}>{icon}</span>}
      </div>
      <div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <span className="metric-card__value">{value}</span>
          {trend && <span className="text-[11px] font-semibold text-[var(--brand-600)]">{trend}</span>}
        </div>
        {note && <p className="mt-2 text-[12px] leading-5 text-[var(--text-muted)]">{note}</p>}
      </div>
    </article>
  );
}
