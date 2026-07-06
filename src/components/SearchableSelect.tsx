"use client";

import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Search } from "lucide-react";

export interface SearchableOption {
  value: string;
  label: string;
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
  placeholder = "Select an option...",
  required = false,
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredOptions = options.filter((opt) =>
    opt.label.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="relative" ref={containerRef}>
      {/* Hidden input to enforce required constraint natively if needed */}
      <input
        type="text"
        required={required}
        value={value}
        onChange={() => {}}
        className="sr-only"
        tabIndex={-1}
      />
      
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs font-semibold text-slate-900 focus-within:border-brand-primary focus-within:ring-2 focus-within:ring-brand-primary/10 transition-all flex items-center justify-between cursor-pointer"
      >
        <span className={selectedOption ? "text-slate-900" : "text-slate-400"}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown size={14} className="text-slate-400" />
      </div>

      {isOpen && (
        <div className="absolute z-50 w-full mt-2 bg-white border border-slate-100 rounded-2xl shadow-xl overflow-hidden animate-in fade-in zoom-in-95 duration-100">
          <div className="p-2 border-b border-slate-100 flex items-center gap-2">
            <Search size={14} className="text-slate-400 ml-2" />
            <input
              type="text"
              autoFocus
              placeholder="Search..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-transparent border-none focus:outline-none text-xs font-semibold text-slate-900 py-2"
            />
          </div>
          
          <div className="max-h-60 overflow-y-auto p-2 space-y-1">
            {filteredOptions.length === 0 ? (
              <div className="p-3 text-xs text-slate-400 text-center font-semibold">
                No results found.
              </div>
            ) : (
              filteredOptions.map((opt) => (
                <div
                  key={opt.value}
                  onClick={() => {
                    onChange(opt.value);
                    setIsOpen(false);
                    setSearchTerm("");
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
