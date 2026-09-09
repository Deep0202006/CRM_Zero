"use client";

import React from "react";
import { cn } from "@/lib/utils";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "elevated" | "interactive" | "muted" | "borderless";
}

export function Card({ children, variant = "default", className = "", ...props }: CardProps) {
  const baseStyles =
    "rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--surface-primary)] p-5 transition-[transform,border-color,box-shadow,background-color] duration-[var(--motion-standard)] ease-[var(--ease-standard)]";

  const variantStyles = {
    default: "shadow-[var(--shadow-raised)]",
    elevated: "border-[var(--border-default)] shadow-[var(--shadow-popover)]",
    interactive:
      "cursor-pointer shadow-[var(--shadow-raised)] hover:-translate-y-px hover:border-[var(--brand-300)] hover:shadow-[var(--shadow-card-hover)]",
    muted: "bg-[var(--surface-secondary)] shadow-none",
    borderless: "border-transparent shadow-none",
  };

  return (
    <div className={`${baseStyles} ${variantStyles[variant]} ${className}`} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ children, className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`mb-4 flex items-start justify-between gap-4 ${className}`} {...props}>
      {children}
    </div>
  );
}

export function CardTitle({ children, className = "", ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={`text-[15px] font-semibold tracking-[-0.015em] text-[var(--text-primary)] ${className}`} {...props}>
      {children}
    </h3>
  );
}

export function CardDescription({ children, className = "", ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={`mt-1 text-[12px] leading-5 text-[var(--text-muted)] ${className}`} {...props}>
      {children}
    </p>
  );
}

export function CardContent({ children, className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={className} {...props}>{children}</div>;
}

// shadcn/ui 5c7072da, MIT (c) 2023 shadcn; retain ZeroData's existing Card spacing.
export function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-action" className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)} {...props} />;
}

export function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-footer" className={cn("flex items-center [.border-t]:pt-4", className)} {...props} />;
}
