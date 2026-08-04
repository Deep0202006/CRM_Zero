/**
 * Shared Date/Time utilities to ensure consistent calculation and formatting
 * across the CRM, specifically enforcing the Asia/Kolkata timezone.
 */

export const IST_TIMEZONE = "Asia/Kolkata";

/**
 * Returns the current date in YYYY-MM-DD format for IST.
 */
export function getCurrentISTDate(): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(new Date());
}

export function isValidISTDateKey(dateKey: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return false;
  const value = new Date(`${dateKey}T00:00:00+05:30`);
  return !Number.isNaN(value.getTime()) && getISTDateKey(value) === dateKey;
}

/** Returns inclusive/exclusive UTC bounds for an Asia/Kolkata business date. */
export function getISTBusinessDayBounds(dateKey: string): { startsAt: string; endsAt: string } {
  if (!isValidISTDateKey(dateKey)) throw new Error("Invalid India business date");
  const start = new Date(`${dateKey}T00:00:00+05:30`);
  if (Number.isNaN(start.getTime())) throw new Error("Invalid India business date");
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { startsAt: start.toISOString(), endsAt: end.toISOString() };
}


/** Returns the Asia/Kolkata business-date key for an arbitrary timestamp. */
export function getISTDateKey(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: IST_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * Returns the current ISO timestamp in IST.
 */
export function getCurrentISTTimestamp(): string {
  return new Date().toLocaleString("sv-SE", { timeZone: IST_TIMEZONE }).replace(" ", "T") + "+05:30";
}

/**
 * Checks if two date strings (YYYY-MM-DD) are exactly the same date.
 */
export function isSameDate(date1: string, date2: string): boolean {
  return date1 === date2;
}
