"use client";

import React from "react";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "elevated" | "interactive";
}

export function Card({ children, variant = "default", className = "", ...props }: CardProps) {
  const baseStyles = "bg-[var(--surface-primary)] border border-[var(--border-subtle)] rounded-[var(--radius-lg)] p-5 transition-all";
  
  const variantStyles = {
    default: "shadow-sm",
    elevated: "shadow-[var(--shadow-popover)] border-transparent",
    interactive: "shadow-sm hover:border-[var(--brand-500)]/30 hover:shadow-md cursor-pointer",
  };

  return (
    <div className={`${baseStyles} ${variantStyles[variant]} ${className}`} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ children, className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={`flex items-center justify-between mb-4 ${className}`} {...props}>{children}</div>;
}

export function CardTitle({ children, className = "", ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={`text-base font-black text-[var(--text-primary)] ${className}`} {...props}>{children}</h3>;
}

export function CardContent({ children, className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={className} {...props}>{children}</div>;
}
