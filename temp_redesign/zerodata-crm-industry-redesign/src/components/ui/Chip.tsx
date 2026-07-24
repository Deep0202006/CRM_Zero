"use client";

import React from "react";

export interface ChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "success" | "warning" | "danger" | "info" | "neutral" | "brand" | "pending";
  size?: "sm" | "md";
  dot?: boolean;
}

export function Chip({ children, variant = "neutral", size = "md", dot = false, className = "", ...props }: ChipProps) {
  const baseStyles = "inline-flex max-w-full items-center border font-semibold leading-none";
  const sizeStyles = {
    sm: "min-h-5 gap-1.5 rounded-[var(--radius-round)] px-2 py-1 text-[10px]",
    md: "min-h-6 gap-1.5 rounded-[var(--radius-round)] px-2.5 py-1 text-[11px]",
  };
  const variantStyles = {
    success: "border-[var(--status-success)]/20 bg-[var(--status-success-soft)] text-[var(--status-success)]",
    warning: "border-[var(--status-warning)]/20 bg-[var(--status-warning-soft)] text-[var(--status-warning)]",
    danger: "border-[var(--status-danger)]/20 bg-[var(--status-danger-soft)] text-[var(--status-danger)]",
    info: "border-[var(--status-info)]/20 bg-[var(--status-info-soft)] text-[var(--status-info)]",
    neutral: "border-[var(--border-default)] bg-[var(--status-neutral-soft)] text-[var(--status-neutral)]",
    brand: "border-[var(--brand-200)] bg-[var(--brand-50)] text-[var(--brand-700)]",
    pending: "border-[var(--status-pending)]/20 bg-[var(--status-pending-soft)] text-[var(--status-pending)]",
  };
  const dotColors = {
    success: "bg-[var(--status-success)]",
    warning: "bg-[var(--status-warning)]",
    danger: "bg-[var(--status-danger)]",
    info: "bg-[var(--status-info)]",
    neutral: "bg-[var(--status-neutral)]",
    brand: "bg-[var(--brand-500)]",
    pending: "bg-[var(--status-pending)]",
  };

  return (
    <span className={`${baseStyles} ${sizeStyles[size]} ${variantStyles[variant]} ${className}`} {...props}>
      {dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotColors[variant]}`} aria-hidden="true" />}
      <span className="truncate">{children}</span>
    </span>
  );
}
