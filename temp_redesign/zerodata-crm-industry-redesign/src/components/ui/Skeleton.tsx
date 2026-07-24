"use client";

import React from "react";

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "text" | "circular" | "rectangular";
  width?: string | number;
  height?: string | number;
}

export function Skeleton({ variant = "text", width, height, className = "", style, ...props }: SkeletonProps) {
  const variantStyles = {
    text: "h-4 w-full rounded-[var(--radius-xs)]",
    circular: "rounded-full",
    rectangular: "rounded-[var(--radius-md)]",
  };

  return (
    <div
      className={`skeleton-shimmer ${variantStyles[variant]} ${className}`}
      style={{ width, height, ...style }}
      aria-hidden="true"
      {...props}
    />
  );
}

export function SkeletonCard() {
  return (
    <div className="space-y-4 rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--surface-primary)] p-5 shadow-[var(--shadow-raised)]">
      <div className="flex items-center justify-between gap-4">
        <Skeleton variant="text" width="45%" height={18} />
        <Skeleton variant="circular" width={32} height={32} />
      </div>
      <Skeleton variant="text" width="90%" height={12} />
      <Skeleton variant="text" width="66%" height={12} />
      <div className="flex gap-2 pt-1">
        <Skeleton variant="rectangular" width={70} height={24} />
        <Skeleton variant="rectangular" width={86} height={24} />
      </div>
    </div>
  );
}
