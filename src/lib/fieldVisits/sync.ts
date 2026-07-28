import { processSyncQueue } from "../db";

/**
 * Compatibility entry point. Field visits now use the single durable outbox
 * and its global processor mutex; no second queue or event listeners exist.
 */
export function syncFieldVisits(): Promise<void> {
  return processSyncQueue();
}
