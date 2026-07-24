"use client";

import React from "react";

interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  eyebrow,
  icon,
  actions,
  meta,
  className = "",
}: PageHeaderProps) {
  return (
    <header className={`flex flex-col gap-4 border-b border-[var(--border-subtle)] pb-5 lg:flex-row lg:items-end lg:justify-between ${className}`}>
      <div className="min-w-0">
        {(eyebrow || icon) && (
          <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.09em] text-[var(--brand-600)]">
            {icon && (
              <span className="grid h-7 w-7 place-items-center rounded-[var(--radius-sm)] bg-[var(--brand-50)] text-[var(--brand-600)]">
                {icon}
              </span>
            )}
            {eyebrow && <span>{eyebrow}</span>}
          </div>
        )}
        <h1 className="max-w-4xl text-[26px] font-semibold leading-[1.15] tracking-[-0.035em] text-[var(--text-primary)] sm:text-[30px]">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-3xl text-[13px] leading-6 text-[var(--text-muted)] sm:text-sm">
            {description}
          </p>
        )}
        {meta && <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
