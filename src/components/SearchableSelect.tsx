"use client";

import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Search } from "lucide-react";

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
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Select or type...",
  required = false,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // We want to display the label if the value matches an option's value,
  // but if it's free-text, we just show the free-text.
  const [displayValue, setDisplayValue] = useState("");

  useEffect(() => {
    const matchedOption = options.find((opt) => opt.value === value);
    if (matchedOption) {
      setDisplayValue(matchedOption.label);
    } else {
      setDisplayValue(value);
    }
  }, [value, options]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredOptions = options.filter((opt) => {
    const searchTarget = (opt.label + " " + opt.value + " " + (opt.searchText || "")).toLowerCase();
    return searchTarget.includes(displayValue.toLowerCase());
  });

  return (
    <div className="relative" ref={containerRef}>
      <div
        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold text-slate-900 focus-within:border-brand-primary focus-within:ring-2 focus-within:ring-brand-primary/10 transition-all flex items-center justify-between"
      >
        <input
          type="text"
          value={displayValue}
          onChange={(e) => {
            const val = e.target.value;
            setDisplayValue(val);
            onChange(val); // By default, pass the text up. If it's a UUID, it gets set when an option is clicked.
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          required={required}
          className="bg-transparent border-none focus:outline-none w-full"
        />
        <ChevronDown 
          size={14} 
          className="text-slate-400 cursor-pointer ml-2 flex-shrink-0" 
          onClick={() => setIsOpen(!isOpen)}
        />
      </div>

      {isOpen && (
        <div className="absolute z-50 w-full mt-2 bg-white border border-slate-100 rounded-2xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-100">
          <div className="max-h-60 overflow-y-auto p-2 space-y-1">
            {filteredOptions.length === 0 ? (
              <div className="p-3 text-xs text-slate-400 font-semibold flex flex-col gap-1">
                <span>No exact matches.</span>
                <span className="text-[10px] opacity-70">"{displayValue}" will be saved as custom.</span>
              </div>
            ) : (
              filteredOptions.map((opt) => (
                <div
                  key={opt.value}
                  onClick={() => {
                    onChange(opt.value);
                    setIsOpen(false);
                  }}
                  className={`px-3 py-2.5 rounded-lg text-xs font-bold cursor-pointer transition-all ${
                    value === opt.value
                      ? "bg-brand-primary text-white"
                      : "hover:bg-slate-50 text-slate-700"
                  }`}
                >
                  {opt.label}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
