"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

export interface SearchableOption {
  value: string;
  label: string;
  searchText?: string;
}

interface SearchableSelectProps {
  options: SearchableOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  label?: string;
  description?: string;
  error?: string;
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Search or select…",
  required = false,
  label,
  description,
  error,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [displayValue, setDisplayValue] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const generatedId = useId();
  const inputId = `combobox-${generatedId}`;
  const listId = `${inputId}-listbox`;
  const descriptionId = description ? `${inputId}-description` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;

  useEffect(() => {
    const matchedOption = options.find((option) => option.value === value);
    setDisplayValue(matchedOption ? matchedOption.label : value);
  }, [value, options]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setActiveIndex(-1);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  const filteredOptions = useMemo(() => {
    const query = displayValue.trim().toLowerCase();
    if (!query) return options;
    return options.filter((option) =>
      `${option.label} ${option.value} ${option.searchText || ""}`.toLowerCase().includes(query)
    );
  }, [displayValue, options]);

  useEffect(() => {
    if (!isOpen || activeIndex < 0) return;
    document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, isOpen, listId]);

  const selectOption = (option: SearchableOption) => {
    onChange(option.value);
    setDisplayValue(option.label);
    setIsOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  };

  return (
    <div ref={containerRef} className="relative w-full">
      {label && (
        <label htmlFor={inputId} className="mb-1.5 flex items-center gap-1 text-[12px] font-semibold text-[var(--text-secondary)]">
          {label}
          {required && <span className="text-[var(--status-danger)]" aria-hidden="true">*</span>}
        </label>
      )}
      {description && <p id={descriptionId} className="mb-1.5 text-[11px] leading-4 text-[var(--text-muted)]">{description}</p>}
      <div
        className={`relative flex h-10 items-center rounded-[var(--radius-md)] border bg-[var(--surface-primary)] transition-[border-color,box-shadow] focus-within:border-[var(--brand-500)] focus-within:ring-4 focus-within:ring-[var(--brand-glow)] ${
          error ? "border-[var(--status-danger)]" : "border-[var(--border-default)] hover:border-[var(--border-strong)]"
        }`}
      >
        <Search size={15} className="pointer-events-none absolute left-3 text-[var(--text-muted)]" aria-hidden="true" />
        <input
          id={inputId}
          ref={inputRef}
          type="text"
          value={displayValue}
          onChange={(event) => {
            const nextValue = event.target.value;
            setDisplayValue(nextValue);
            onChange(nextValue);
            setIsOpen(true);
            setActiveIndex(0);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setIsOpen(true);
              setActiveIndex((index) => Math.min(index + 1, filteredOptions.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) => Math.max(index - 1, 0));
            } else if (event.key === "Enter" && isOpen && activeIndex >= 0 && filteredOptions[activeIndex]) {
              event.preventDefault();
              selectOption(filteredOptions[activeIndex]);
            } else if (event.key === "Escape") {
              setIsOpen(false);
              setActiveIndex(-1);
            }
          }}
          placeholder={placeholder}
          required={required}
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
          aria-invalid={Boolean(error) || undefined}
          aria-required={required || undefined}
          aria-describedby={[descriptionId, errorId].filter(Boolean).join(" ") || undefined}
          className="h-full w-full bg-transparent pl-9 pr-10 text-[13px] font-medium text-[var(--text-primary)] outline-none"
        />
        <button
          type="button"
          onClick={() => {
            setIsOpen((open) => !open);
            inputRef.current?.focus();
          }}
          className="absolute right-1 grid h-8 w-8 place-items-center rounded-[var(--radius-sm)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
          aria-label={isOpen ? "Close options" : "Open options"}
          tabIndex={-1}
        >
          <ChevronDown size={15} className={`transition-transform ${isOpen ? "rotate-180" : ""}`} />
        </button>
      </div>

      {error && <p id={errorId} role="alert" className="mt-1.5 text-[11px] font-medium text-[var(--status-danger)]">{error}</p>}

      {isOpen && (
        <div
          id={listId}
          role="listbox"
          className="absolute z-[var(--z-dropdown)] mt-2 w-full overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--surface-elevated)] p-1.5 shadow-[var(--shadow-popover)]"
        >
          <div className="max-h-64 overflow-y-auto">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-4">
                <p className="text-[12px] font-semibold text-[var(--text-secondary)]">No exact match</p>
                <p className="mt-1 text-[11px] leading-4 text-[var(--text-muted)]">“{displayValue}” will be kept as a custom value.</p>
              </div>
            ) : (
              filteredOptions.map((option, index) => {
                const selected = value === option.value;
                const active = activeIndex === index;
                return (
                  <button
                    id={`${listId}-${index}`}
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectOption(option)}
                    className={`flex w-full items-center justify-between gap-3 rounded-[var(--radius-sm)] px-3 py-2.5 text-left text-[12px] font-medium transition-colors ${
                      active ? "bg-[var(--surface-hover)] text-[var(--text-primary)]" : "text-[var(--text-secondary)]"
                    }`}
                  >
                    <span className="truncate">{option.label}</span>
                    {selected && <Check size={14} className="shrink-0 text-[var(--brand-600)]" aria-hidden="true" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
