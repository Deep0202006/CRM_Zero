"use client";

import React from "react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger" | "success";
  size?: "sm" | "md" | "lg";
  isLoading?: boolean;
  icon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      children,
      variant = "primary",
      size = "md",
      isLoading = false,
      icon,
      trailingIcon,
      className = "",
      disabled,
      type = "button",
      ...props
    },
    ref
  ) => {
    const baseStyles =
      "inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap font-semibold transition-[transform,background-color,border-color,color,box-shadow] duration-[var(--motion-feedback)] ease-[var(--ease-standard)] active:scale-[0.98] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50";

    const sizeStyles = {
      sm: "h-8 gap-1.5 rounded-[var(--radius-sm)] px-3 text-[12px]",
      md: "h-9 gap-2 rounded-[var(--radius-md)] px-3.5 text-[13px]",
      lg: "h-11 gap-2.5 rounded-[var(--radius-md)] px-5 text-[14px]",
    };

    const variantStyles = {
      primary:
        "border border-transparent bg-[var(--brand-500)] text-[var(--brand-contrast)] shadow-[var(--shadow-brand)] hover:bg-[var(--brand-600)]",
      secondary:
        "border border-[var(--border-subtle)] bg-[var(--surface-secondary)] text-[var(--text-primary)] hover:border-[var(--border-default)] hover:bg-[var(--surface-tertiary)]",
      outline:
        "border border-[var(--border-default)] bg-[var(--surface-primary)] text-[var(--text-primary)] shadow-[var(--shadow-control)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]",
      ghost:
        "border border-transparent bg-transparent text-[var(--text-secondary)] shadow-none hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]",
      danger:
        "border border-transparent bg-[var(--status-danger)] text-white shadow-sm hover:brightness-95",
      success:
        "border border-transparent bg-[var(--status-success)] text-white shadow-sm hover:brightness-95",
    };

    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || isLoading}
        aria-busy={isLoading || undefined}
        className={`${baseStyles} ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
        {...props}
      >
        {isLoading ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />
        ) : icon ? (
          <span className="grid shrink-0 place-items-center" aria-hidden="true">{icon}</span>
        ) : null}
        {children}
        {!isLoading && trailingIcon ? <span className="grid shrink-0 place-items-center" aria-hidden="true">{trailingIcon}</span> : null}
      </button>
    );
  }
);

Button.displayName = "Button";
