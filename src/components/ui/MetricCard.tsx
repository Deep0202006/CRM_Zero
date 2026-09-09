"use client";

import React from "react";
import { CardAction, CardFooter } from "./Card";

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
        {icon && <CardAction className={`grid h-7 w-7 shrink-0 place-items-center rounded-[var(--radius-sm)] ${toneStyles[tone]}`}>{icon}</CardAction>}
      </div>
      <div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <span className="metric-card__value">{value}</span>
          {trend && <span className="text-xs font-semibold text-[var(--text-secondary)]">{trend}</span>}
        </div>
        {note && <CardFooter className="mt-2 text-xs leading-[18px] text-[var(--text-secondary)]">{note}</CardFooter>}
      </div>
    </article>
  );
}
