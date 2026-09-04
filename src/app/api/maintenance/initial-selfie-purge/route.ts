import { INITIAL_PURGE_CUTOFF_IST, runInitialEvidencePurge } from "@/lib/fieldVisits/initialPurge";
import { createServerServiceClient } from "@/lib/serverBackendEnvironment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ ok: false, code: "AUTH_REQUIRED" }, { status: 401 });
  const body = await request.json().catch(() => null) as { mode?: string; cutoff?: string } | null;
  if (!body || !["dry-run", "execute"].includes(body.mode ?? "") || body.cutoff !== INITIAL_PURGE_CUTOFF_IST) return Response.json({ ok: false, code: "EXACT_SCOPE_REQUIRED" }, { status: 400 });
  const serviceResult = createServerServiceClient();
  if (!serviceResult.ok) return Response.json({ ok: false, code: "NOT_CONFIGURED", backend_reason: serviceResult.reason }, { status: 503 });
  const result = await runInitialEvidencePurge(serviceResult.client, body.mode === "dry-run");
  if (result.unrelatedObjectsSelected !== 0) return Response.json({ ok: false, code: "UNRELATED_SCOPE_REJECTED", ...result }, { status: 409 });
  console.info("Initial selfie purge aggregate", result);
  return Response.json({ ok: result.failures === 0, cutoff: INITIAL_PURGE_CUTOFF_IST, businessRowsDeleted: 0, ...result }, { status: result.failures ? 500 : 200, headers: { "Cache-Control": "no-store" } });
}
