import { apiError, contextFor } from "@/lib/receivables/server";
import { listErpSystems } from "@/lib/erp/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const context = await contextFor(request);
  if (context instanceof Response) return context;
  if (!context) return apiError(401, "AUTH_REQUIRED", "Sign in again.");
  if (!context.isAdmin)
    return apiError(
      403,
      "ADMIN_REQUIRED",
      "System Administrator access required.",
    );
  try {
    return Response.json({ rows: await listErpSystems(context.service) });
  } catch {
    return apiError(
      503,
      "ERP_DIRECTORY_UNAVAILABLE",
      "ERP suggestions could not be loaded.",
    );
  }
}
