import { contextFor, isReceivablesReady } from "@/lib/receivables/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await contextFor(request);
  if (!context) {
    return Response.json({ ready: false, code: "AUTH_REQUIRED" }, { status: 401 });
  }

  if (!isReceivablesReady()) {
    return Response.json({
      ready: false,
      code: "RECEIVABLES_NOT_ENABLED",
      ...(context.isAdmin ? { message: "Payment Collections is awaiting database activation." } : {}),
    });
  }

  const { error: readError } = await context.service
    .from("receivables_financial_read_v1")
    .select("receivable_id")
    .limit(0);

  if (readError) {
    return Response.json({
      ready: false,
      code: "RECEIVABLES_SCHEMA_UNAVAILABLE",
      ...(context.isAdmin ? { message: "The Payment Collections database contract is unavailable." } : {}),
    });
  }

  if (context.isAdmin) {
    const { error: metricsError } = await context.service.rpc("receivables_admin_metrics_v1", {
      p_actor_id: context.userId,
    });
    if (metricsError) {
      return Response.json({
        ready: false,
        code: "RECEIVABLES_SCHEMA_UNAVAILABLE",
        message: "The Payment Collections reporting contract is unavailable.",
      });
    }
  }

  return Response.json({ ready: true });
}
