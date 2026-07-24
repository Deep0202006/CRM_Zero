"use client";

import React, { useId } from "react";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  description?: string;
  error?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  containerClassName?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ label, description, error, leftIcon, rightIcon, className = "", containerClassName = "", id, required, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id || `field-${generatedId}`;
    const descriptionId = description ? `${inputId}-description` : undefined;
    const errorId = error ? `${inputId}-error` : undefined;

    return (
      <div className={`w-full ${containerClassName}`}>
        {label && (
          <label htmlFor={inputId} className="mb-1.5 flex items-center gap-1 text-[12px] font-semibold text-[var(--text-secondary)]">
            {label}
            {required && <span className="text-[var(--status-danger)]" aria-hidden="true">*</span>}
          </label>
        )}
        {description && <p id={descriptionId} className="mb-1.5 text-[11px] leading-4 text-[var(--text-muted)]">{description}</p>}
        <div className="relative flex items-center">
          {leftIcon && <span className="pointer-events-none absolute left-3 grid place-items-center text-[var(--text-muted)]" aria-hidden="true">{leftIcon}</span>}
          <input
            id={inputId}
            ref={ref}
            required={required}
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={[descriptionId, errorId].filter(Boolean).join(" ") || undefined}
            className={`h-10 w-full rounded-[var(--radius-md)] border bg-[var(--surface-primary)] text-[13px] font-medium text-[var(--text-primary)] shadow-[var(--shadow-control)] transition-[border-color,box-shadow,background-color] duration-[var(--motion-feedback)] placeholder:font-normal focus:border-[var(--brand-500)] focus:outline-none focus:ring-4 focus:ring-[var(--brand-glow)] disabled:cursor-not-allowed disabled:bg-[var(--surface-disabled)] disabled:text-[var(--text-disabled)] ${
              leftIcon ? "pl-10" : "pl-3"
            } ${rightIcon ? "pr-11" : "pr-3"} ${
              error ? "border-[var(--status-danger)] focus:border-[var(--status-danger)] focus:ring-[var(--status-danger-soft)]" : "border-[var(--border-default)] hover:border-[var(--border-strong)]"
            } ${className}`}
            {...props}
          />
          {rightIcon && <span className="absolute right-1 grid h-8 w-8 place-items-center text-[var(--text-muted)]">{rightIcon}</span>}
        </div>
        {error && <p id={errorId} role="alert" className="mt-1.5 text-[11px] font-medium text-[var(--status-danger)]">{error}</p>}
      </div>
    );
  }
);

Input.displayName = "Input";
