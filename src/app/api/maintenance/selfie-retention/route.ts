import { createClient } from "@supabase/supabase-js";
import { purgeExpiredSelfies } from "@/lib/fieldVisits/retention";

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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ ok: false, code: "RETENTION_NOT_CONFIGURED" }, { status: 503 });
  try {
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const result = await purgeExpiredSelfies(client);
    console.info("Selfie retention completed", result);
    return Response.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Selfie retention failed", { code: error instanceof Error ? error.message.split(":")[0] : "UNKNOWN" });
    return Response.json({ ok: false, code: "RETENTION_RUN_FAILED" }, { status: 500 });
  }
}
