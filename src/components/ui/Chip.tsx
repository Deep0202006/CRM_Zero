"use client";

import React from "react";

export interface ChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "success" | "warning" | "danger" | "info" | "neutral" | "brand" | "pending";
  size?: "sm" | "md";
  dot?: boolean;
}

export function Chip({
  children,
  variant = "neutral",
  size = "md",
  dot = false,
  className = "",
  ...props
}: ChipProps) {
  const baseStyles = "inline-flex items-center font-bold border rounded-[var(--radius-round)]";

  const sizeStyles = {
    sm: "px-2 py-0.5 text-[10px] gap-1",
    md: "px-2.5 py-1 text-xs gap-1.5",
  };

  const variantStyles = {
    success: "bg-[var(--status-success-soft)] text-[var(--status-success)] border-[var(--status-success)]/20",
    warning: "bg-[var(--status-warning-soft)] text-[var(--status-warning)] border-[var(--status-warning)]/20",
    danger: "bg-[var(--status-danger-soft)] text-[var(--status-danger)] border-[var(--status-danger)]/20",
    info: "bg-[var(--status-info-soft)] text-[var(--status-info)] border-[var(--status-info)]/20",
    neutral: "bg-[var(--status-neutral-soft)] text-[var(--status-neutral)] border-[var(--border-default)]",
    brand: "bg-[var(--brand-50)] text-[var(--brand-500)] border-[var(--brand-500)]/20",
    pending: "bg-[var(--status-pending-soft)] text-[var(--status-pending)] border-[var(--status-pending)]/20",
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
      {dot && <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotColors[variant]}`} />}
      {children}
    </span>
  );
}
