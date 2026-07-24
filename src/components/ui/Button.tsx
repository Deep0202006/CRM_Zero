"use client";

import React from "react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger" | "success";
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
  icon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      variant = "primary",
      size = "md",
      isLoading = false,
      icon,
      className = "",
      disabled,
      ...props
    },
    ref
  ) => {
    const baseStyles =
      "inline-flex items-center justify-center font-bold transition-all focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-50 disabled:pointer-events-none cursor-pointer active:scale-[0.98]";

    const sizeStyles = {
      sm: "h-8 px-3 text-xs rounded-[var(--radius-sm)] gap-1.5",
      md: "h-9 px-4 text-xs rounded-[var(--radius-md)] gap-2",
      lg: "h-11 px-5 text-sm rounded-[var(--radius-lg)] gap-2.5",
    };

    const variantStyles = {
      primary:
        "bg-[var(--brand-500)] text-white hover:bg-[var(--brand-600)] shadow-sm shadow-[var(--brand-500)]/20 focus-visible:outline-[var(--brand-500)]",
      secondary:
        "bg-[var(--surface-secondary)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)] border border-[var(--border-default)]",
      outline:
        "border border-[var(--border-default)] bg-[var(--surface-primary)] text-[var(--text-primary)] hover:bg-[var(--surface-hover)]",
      ghost:
        "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-hover)]",
      danger:
        "bg-[var(--status-danger)] text-white hover:opacity-90 shadow-sm focus-visible:outline-[var(--status-danger)]",
      success:
        "bg-[var(--status-success)] text-white hover:opacity-90 shadow-sm focus-visible:outline-[var(--status-success)]",
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={`${baseStyles} ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
        {...props}
      >
        {isLoading ? (
          <span className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full mr-2" />
        ) : icon ? (
          <span className="shrink-0">{icon}</span>
        ) : null}
        {children}
      </button>
    );
  }
);

Button.displayName = "Button";
