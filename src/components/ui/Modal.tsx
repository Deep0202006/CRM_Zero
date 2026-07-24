"use client";

import React, { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
}

const sizes = {
  sm: "max-w-[420px]",
  md: "max-w-[540px]",
  lg: "max-w-[720px]",
};

export function Modal({ open, onClose, title, description, children, footer, size = "md" }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => {
      const firstField = panelRef.current?.querySelector<HTMLElement>(
        '[data-autofocus], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]):not([data-modal-close])'
      );
      (firstField || closeRef.current)?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={`modal-panel ${sizes[size]}`}
      >
        <div className="flex items-start justify-between gap-5 border-b border-[var(--border-subtle)] px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 id={titleId} className="text-[17px] font-semibold tracking-[-0.02em] text-[var(--text-primary)]">
              {title}
            </h2>
            {description && <p id={descriptionId} className="mt-1 text-[13px] leading-5 text-[var(--text-muted)]">{description}</p>}
          </div>
          <button
            ref={closeRef}
            data-modal-close
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-md)] text-[var(--text-muted)] transition hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
            aria-label="Close dialog"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-5 sm:px-6">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-5 py-4 sm:px-6">{footer}</div>}
      </div>
    </div>
  );
}
