"use client";

import React from "react";

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "text" | "circular" | "rectangular";
  width?: string | number;
  height?: string | number;
}

export function Skeleton({
  variant = "text",
  width,
  height,
  className = "",
  style,
  ...props
}: SkeletonProps) {
  const baseStyles = "animate-pulse bg-[var(--surface-secondary)] rounded-[var(--radius-sm)]";

  const variantStyles = {
    text: "h-4 w-full rounded-[var(--radius-xs)]",
    circular: "rounded-full",
    rectangular: "rounded-[var(--radius-md)]",
  };

  const inlineStyles: React.CSSProperties = {
    width,
    height,
    ...style,
  };

  return (
    <div
      className={`${baseStyles} ${variantStyles[variant]} ${className}`}
      style={inlineStyles}
      {...props}
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="bg-[var(--surface-primary)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-4 space-y-3">
      <Skeleton variant="text" width="60%" height={20} />
      <Skeleton variant="text" width="90%" height={14} />
      <div className="flex gap-2 pt-2">
        <Skeleton variant="rectangular" width={60} height={22} />
        <Skeleton variant="rectangular" width={80} height={22} />
      </div>
    </div>
  );
}
