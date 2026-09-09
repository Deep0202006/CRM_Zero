/** One context per logical report. Never pass a fresh budget to a child reader. */
export class ReportUnavailable extends Error {}
type Reader<T> = PromiseLike<T> & {
  retry(enabled: boolean): Reader<T>;
  abortSignal(signal: AbortSignal): Reader<T>;
};

export function createReportResource(incoming: AbortSignal, maximum = 24, deadlineMs = 8000) {
  const controller = new AbortController(), started = Date.now(), deadline = started + deadlineMs;
  const abort = () => controller.abort();
  incoming.addEventListener("abort", abort, { once: true });
  if (incoming.aborted) abort();
  const timer = setTimeout(abort, deadlineMs);
  const diagnostics = { reader_requests: 0, authorization_db_requests: 0, received_rows: 0, received_bytes: 0, peak_active_reads: 0, elapsed_ms: 0 };
  let active = 0;
  function check() {
    if (controller.signal.aborted || Date.now() >= deadline) throw new ReportUnavailable("REPORT_CANCELLED_OR_DEADLINE");
  }
  return {
    signal: controller.signal, diagnostics, check,
    async read<T>(query: Reader<T>, authorization = false): Promise<T> {
      check();
      const key = authorization ? "authorization_db_requests" : "reader_requests";
      if (diagnostics[key] >= (authorization ? 2 : maximum)) throw new ReportUnavailable("REPORT_REQUEST_LIMIT");
      diagnostics[key]++;
      diagnostics.peak_active_reads = Math.max(diagnostics.peak_active_reads, ++active);
      try {
        const result = await query.retry(false).abortSignal(controller.signal);
        check();
        const data = (result as { data?: unknown }).data;
        diagnostics.received_rows += Array.isArray(data) ? data.length : data ? 1 : 0;
        diagnostics.received_bytes += new TextEncoder().encode(JSON.stringify(data ?? null)).byteLength;
        return result;
      } finally { active--; diagnostics.elapsed_ms = Date.now() - started; }
    },
    finish() { clearTimeout(timer); incoming.removeEventListener("abort", abort); diagnostics.elapsed_ms = Date.now() - started; },
  };
}
export type ReportResource = ReturnType<typeof createReportResource>;
export function boundedReportJson(value: unknown, maximum = 1024 * 1024) {
  const body = JSON.stringify(value);
  if (new TextEncoder().encode(body).byteLength > maximum) throw new ReportUnavailable("REPORT_PAYLOAD_LIMIT");
  return new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
