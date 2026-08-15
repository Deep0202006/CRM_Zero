"use client";

import { useEffect, useRef, useState } from "react";

interface NumberTickerProps {
  value: number;
  className?: string;
  duration?: number;
  format?: Intl.NumberFormatOptions;
}

export function NumberTicker({ value, className = "", duration = 560, format }: NumberTickerProps) {
  const [displayValue, setDisplayValue] = useState(value);
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (hasAnimated.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setDisplayValue(value);
      hasAnimated.current = true;
      return;
    }

    hasAnimated.current = true;
    const startedAt = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(value * eased);
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [duration, value]);

  const fractionDigits = format?.maximumFractionDigits ?? 0;
  const normalized = fractionDigits > 0 ? displayValue : Math.round(displayValue);
  return (
    <span className={`tabular-nums ${className}`} aria-label={new Intl.NumberFormat("en-IN", format).format(value)}>
      {new Intl.NumberFormat("en-IN", format).format(normalized)}
    </span>
  );
}
