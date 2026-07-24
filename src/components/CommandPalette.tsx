"use client";

import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowRight, Command, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";

export interface CommandItem {
  label: string;
  path: string;
  description?: string;
  group?: string;
  icon?: React.ReactNode;
  keywords?: string[];
}

interface CommandPaletteProps {
  items: CommandItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ items, open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    const previousOverflow = document.body.style.overflow;
    const handleTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
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
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleTab);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleTab);
      previous?.focus();
      setQuery("");
      setActiveIndex(0);
    };
  }, [open]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
      }
      if (event.key === "Escape" && open) onOpenChange(false);
    }
    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, [onOpenChange, open]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return items;
    return items.filter((item) =>
      [item.label, item.description, item.group, ...(item.keywords || [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalized)
    );
  }, [items, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!filtered.length) {
      setActiveIndex(0);
      return;
    }
    setActiveIndex((index) => Math.min(index, filtered.length - 1));
  }, [filtered.length]);

  useEffect(() => {
    if (!open || !filtered[activeIndex]) return;
    document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, filtered, listId, open]);

  const choose = (item: CommandItem) => {
    onOpenChange(false);
    router.push(item.path);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[var(--z-command)] flex items-start justify-center bg-[var(--surface-overlay)] px-4 pt-[10dvh] backdrop-blur-[8px]"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onOpenChange(false)}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search ZeroData CRM"
        className="w-full max-w-[680px] overflow-hidden rounded-[var(--radius-xl)] border border-[var(--border-default)] bg-[var(--surface-elevated)] shadow-[var(--shadow-dialog)] animate-[zd-dialog-in_var(--motion-overlay)_var(--ease-enter)_both]"
      >
        <div className="flex h-14 items-center gap-3 border-b border-[var(--border-subtle)] px-4">
          <Search size={18} className="shrink-0 text-[var(--brand-600)]" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((index) => Math.min(index + 1, filtered.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter" && filtered[activeIndex]) {
                event.preventDefault();
                choose(filtered[activeIndex]);
              }
            }}
            placeholder="Search pages, queues, and workspaces…"
            className="h-full min-w-0 flex-1 bg-transparent text-[15px] font-medium text-[var(--text-primary)] outline-none placeholder:text-[var(--text-disabled)]"
            role="combobox"
            aria-label="Search commands"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={filtered[activeIndex] ? `${listId}-${activeIndex}` : undefined}
          />
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
            aria-label="Close search"
          >
            <X size={17} />
          </button>
        </div>

        <div className="max-h-[min(58dvh,520px)] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="px-5 py-14 text-center">
              <div className="mx-auto grid h-11 w-11 place-items-center rounded-[var(--radius-lg)] bg-[var(--surface-secondary)] text-[var(--text-muted)]">
                <Search size={20} />
              </div>
              <p className="mt-4 text-[14px] font-semibold text-[var(--text-primary)]">No matching workspace</p>
              <p className="mt-1 text-[12px] text-[var(--text-muted)]">Try a page name such as “pipeline”, “support”, or “attendance”.</p>
            </div>
          ) : (
            <div id={listId} role="listbox" aria-label="Available commands">
              {filtered.map((item, index) => (
                <button
                  id={`${listId}-${index}`}
                  key={`${item.path}-${item.label}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(item)}
                  className={`flex w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-3 text-left transition-colors ${
                    index === activeIndex ? "bg-[var(--brand-50)]" : "hover:bg-[var(--surface-hover)]"
                  }`}
                >
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-md)] ${index === activeIndex ? "bg-[var(--brand-100)] text-[var(--brand-700)]" : "bg-[var(--surface-secondary)] text-[var(--text-muted)]"}`}>
                    {item.icon || <Command size={16} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-[var(--text-primary)]">{item.label}</span>
                    {item.description && <span className="mt-0.5 block truncate text-[11px] text-[var(--text-muted)]">{item.description}</span>}
                  </span>
                  <span className="hidden text-[10px] font-semibold uppercase tracking-[0.06em] text-[var(--text-disabled)] sm:block">{item.group}</span>
                  <ArrowRight size={15} className="shrink-0 text-[var(--text-disabled)]" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--border-subtle)] bg-[var(--surface-secondary)] px-4 py-2.5 text-[10px] font-medium text-[var(--text-muted)]">
          <span className="flex items-center gap-2"><kbd className="rounded border border-[var(--border-default)] bg-[var(--surface-primary)] px-1.5 py-0.5">↑↓</kbd> Navigate</span>
          <span className="flex items-center gap-2"><kbd className="rounded border border-[var(--border-default)] bg-[var(--surface-primary)] px-1.5 py-0.5">Enter</kbd> Open</span>
          <span className="flex items-center gap-2"><kbd className="rounded border border-[var(--border-default)] bg-[var(--surface-primary)] px-1.5 py-0.5">Esc</kbd> Close</span>
        </div>
      </div>
    </div>
  );
}
