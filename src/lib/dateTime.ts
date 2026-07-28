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
