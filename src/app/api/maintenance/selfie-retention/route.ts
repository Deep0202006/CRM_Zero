import { purgeExpiredSelfies } from "@/lib/fieldVisits/retention";
import { createServerServiceClient } from "@/lib/serverBackendEnvironment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization") ?? "";
  return Boolean(secret && authorization === `Bearer ${secret}`);
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ ok: false, code: "CRON_AUTH_REQUIRED" }, { status: 401 });
  const serviceResult = createServerServiceClient();
  if (!serviceResult.ok) return Response.json({ ok: false, code: "RETENTION_NOT_CONFIGURED", backend_reason: serviceResult.reason }, { status: 503 });
  try {
    const result = await purgeExpiredSelfies(serviceResult.client);
    console.info("Selfie retention completed", result);
    return Response.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Selfie retention failed", { code: error instanceof Error ? error.message.split(":")[0] : "UNKNOWN" });
    return Response.json({ ok: false, code: "RETENTION_RUN_FAILED" }, { status: 500 });
  }
}
