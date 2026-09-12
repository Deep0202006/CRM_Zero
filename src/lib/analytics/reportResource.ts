/** One context per logical report. Never pass a fresh budget to a child reader. */
export class ReportUnavailable extends Error {}
type Reader<T> = PromiseLike<T> & {
  retry(enabled: boolean): Reader<T>;
  abortSignal(signal: AbortSignal): Reader<T>;
  setHeader(name: string, value: string): Reader<T>;
};

export function createReportResource(incoming: AbortSignal, maximum = 24, deadlineMs = 8000) {
  const controller = new AbortController(), started = Date.now(), deadline = started + deadlineMs;
  const abort = () => controller.abort();
  incoming.addEventListener("abort", abort, { once: true });
  if (incoming.aborted) abort();
  const timer = setTimeout(abort, deadlineMs);
  const diagnostics = { reader_requests: 0, authorization_db_requests: 0, auth_http_requests: 0, reader_http_requests: 0, authorization_db_http_requests: 0,
    received_rows: 0, decoded_data_bytes: 0, peak_active_reads: 0, elapsed_ms: 0 };
  const tickets = new Set<string>();
  let active = 0;
  function check() {
    if (controller.signal.aborted || Date.now() >= deadline) throw new ReportUnavailable("REPORT_CANCELLED_OR_DEADLINE");
  }
  return {
    signal: controller.signal, diagnostics, check,
    async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      check();
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      const ticket = headers.get("x-zd-report-read");
      headers.delete("x-zd-report-read");
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname.endsWith("/auth/v1/user") && (init?.method ?? "GET").toUpperCase() === "GET") {
        if (diagnostics.auth_http_requests >= 1) throw new ReportUnavailable("AUTH_HTTP_REQUEST_LIMIT");
        diagnostics.auth_http_requests++;
      } else {
        // Each charged read permits exactly one physical attempt, even if an SDK retries.
        if (!ticket || !tickets.delete(ticket)) throw new ReportUnavailable("UNCHARGED_REPORT_HTTP_REQUEST");
        if (ticket.startsWith("authorization:")) diagnostics.authorization_db_http_requests++;
        else diagnostics.reader_http_requests++;
      }
      const signal = init?.signal ? AbortSignal.any([controller.signal, init.signal]) : controller.signal;
      const response = await globalThis.fetch(input, { ...init, headers, signal });
      check();
      return response;
    },
    async read<T>(query: Reader<T>, authorization = false): Promise<T> {
      check();
      const key = authorization ? "authorization_db_requests" : "reader_requests";
      if (diagnostics[key] >= (authorization ? 2 : maximum)) throw new ReportUnavailable("REPORT_REQUEST_LIMIT");
      diagnostics[key]++;
      const ticket = `${authorization ? "authorization" : "reader"}:${diagnostics[key]}`;
      tickets.add(ticket);
      diagnostics.peak_active_reads = Math.max(diagnostics.peak_active_reads, ++active);
      try {
        const result = await query.setHeader("x-zd-report-read", ticket).retry(false).abortSignal(controller.signal);
        check();
        const data = (result as { data?: unknown }).data;
        diagnostics.received_rows += Array.isArray(data) ? data.length : data ? 1 : 0;
        diagnostics.decoded_data_bytes += new TextEncoder().encode(JSON.stringify(data ?? null)).byteLength;
        return result;
      } finally { tickets.delete(ticket); active--; diagnostics.elapsed_ms = Date.now() - started; }
    },
    finish() { clearTimeout(timer); incoming.removeEventListener("abort", abort); controller.abort(); tickets.clear(); diagnostics.elapsed_ms = Date.now() - started; },
  };
}
export type ReportResource = ReturnType<typeof createReportResource>;
export function boundedReportJson(value: unknown, maximum = 1024 * 1024) {
  const body = JSON.stringify(value);
  if (new TextEncoder().encode(body).byteLength > maximum) throw new ReportUnavailable("REPORT_PAYLOAD_LIMIT");
  return new Response(body, { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
