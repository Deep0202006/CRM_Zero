import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { listErpSystems } from "@/lib/erp/server";
import { canonicalErpIdSchema } from "@/lib/erp/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const segmentSchema = z.enum(["Retailer", "Distributor"]);
const stateSchema = z.enum(["erp", "none", "not_captured"]);
export const erpIdSchema = canonicalErpIdSchema;
const operationSchema = z.union([
  z.object({ operation: z.literal("set"), segment_type: segmentSchema, business_ref: z.string().trim().min(1).max(256), erp_id: erpIdSchema }).strict(),
  z.object({ operation: z.literal("set"), segment_type: segmentSchema, business_ref: z.string().trim().min(1).max(256), erp_name: z.string().trim().min(1).max(160) }).strict(),
  z.object({ operation: z.literal("none"), segment_type: segmentSchema, business_ref: z.string().trim().min(1).max(256) }).strict(),
  z.object({ operation: z.literal("clear"), segment_type: segmentSchema, business_ref: z.string().trim().min(1).max(256) }).strict(),
]);
const batchSchema = z.object({ operations: z.array(operationSchema).min(1).max(500) }).strict();

const safeWriteMessages: Record<string, string> = {
  ADMIN_REQUIRED: "Administrator access is required.",
  BATCH_SIZE_INVALID: "Select between 1 and 500 businesses.",
  DUPLICATE_BUSINESS: "Each business can appear only once in a batch.",
  BUSINESS_NOT_VISITED: "One or more businesses no longer exist in visited-business scope.",
  ERP_INPUT_INVALID: "One or more ERP selections are invalid.",
  ERP_INVALID: "One or more selected ERP systems no longer exist.",
};

async function authorize(request: Request): Promise<
  | { service: SupabaseClient; actorId: string }
  | { response: Response }
> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!url || !serviceKey || !token) return { response: Response.json({ code: "AUTH_REQUIRED" }, { status: 401 }) };
  const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: identity, error: identityError } = await service.auth.getUser(token);
  if (identityError || !identity.user) return { response: Response.json({ code: "AUTH_REQUIRED" }, { status: 401 }) };
  const [{ data: account }, { data: capabilities }] = await Promise.all([
    service.from("users").select("is_active").eq("user_id", identity.user.id).maybeSingle(),
    service.from("user_capabilities").select("capability_code").eq("user_id", identity.user.id),
  ]);
  const isAdmin = (capabilities ?? []).some((row) => row.capability_code === "admin");
  if (!(account?.is_active === true || account?.is_active === 1) || !isAdmin) {
    return { response: Response.json({ code: "ADMIN_REQUIRED" }, { status: 403 }) };
  }
  return { service, actorId: identity.user.id };
}

export async function GET(request: Request) {
  const authorization = await authorize(request);
  if ("response" in authorization) return authorization.response;
  const params = new URL(request.url).searchParams;
  const rawSegment = params.get("segment");
  const parsedSegment = rawSegment ? segmentSchema.safeParse(rawSegment) : null;
  if (parsedSegment && !parsedSegment.success) return Response.json({ code: "FILTER_INVALID" }, { status: 400 });
  const businessRef = params.get("business_ref")?.trim() || null;
  if (businessRef && businessRef.length > 256) return Response.json({ code: "FILTER_INVALID" }, { status: 400 });
  const rawState = params.get("state");
  const parsedState = rawState ? stateSchema.safeParse(rawState) : null;
  if (parsedState && !parsedState.success) return Response.json({ code: "FILTER_INVALID" }, { status: 400 });
  const textSearch = params.get("query")?.normalize("NFKC").trim().replace(/\s+/g, " ") || "";
  if (textSearch.length > 160) return Response.json({ code: "FILTER_INVALID" }, { status: 400 });
  const requestedLimit = Number(params.get("limit") ?? "500");
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1) return Response.json({ code: "FILTER_INVALID" }, { status: 400 });
  const limit = Math.min(requestedLimit, 500);
  try {
    const [{ data: projectedRows, error }, erpSystems] = await Promise.all([
      authorization.service.rpc("field_business_erp_current_v2", {
        p_segment_type: parsedSegment?.data ?? null,
        p_business_ref: businessRef,
        p_limit: limit,
      }),
      listErpSystems(authorization.service),
    ]);
    if (error) return Response.json({ code: "ERP_BASELINES_UNAVAILABLE" }, { status: 503 });
    const rows = (projectedRows ?? []) as Array<Record<string, unknown> & { business_ref: string; erp_usage_state: string | null; erp_name: string | null }>;
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const leadIds = [...new Set(rows.map((row) => row.business_ref).filter((value) => uuidPattern.test(value)))];
    const { data: leads, error: leadsError } = leadIds.length
      ? await authorization.service.from("leads").select("lead_id,business_name").in("lead_id", leadIds).limit(500)
      : { data: [], error: null };
    if (leadsError) return Response.json({ code: "ERP_BASELINES_UNAVAILABLE" }, { status: 503 });
    const names = new Map((leads ?? []).map((lead) => [String(lead.lead_id), typeof lead.business_name === "string" ? lead.business_name : null]));
    const queryKey = textSearch.toLocaleLowerCase("en-IN");
    const enrichedRows = rows.map((row) => ({ ...row, business_name: names.get(row.business_ref) ?? null })).filter((row) => {
      const state = row.erp_usage_state === "erp" ? "erp" : row.erp_usage_state === "none" ? "none" : "not_captured";
      if (parsedState?.data && state !== parsedState.data) return false;
      if (!queryKey) return true;
      return [row.business_name, row.business_ref, row.erp_name].some((value) => typeof value === "string" && value.toLocaleLowerCase("en-IN").includes(queryKey));
    });
    return Response.json({ rows: enrichedRows, erp_systems: erpSystems.map(({ erp_id, erp_name }) => ({ erp_id, erp_name })), limit }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ code: "ERP_BASELINES_UNAVAILABLE" }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const authorization = await authorize(request);
  if ("response" in authorization) return authorization.response;
  let raw: unknown;
  try { raw = await request.json(); } catch { return Response.json({ code: "INVALID_JSON", message: "The edit request is invalid." }, { status: 400 }); }
  const parsed = batchSchema.safeParse(raw);
  if (!parsed.success) return Response.json({ code: "VALIDATION_FAILED", message: "Check the selected business ERP edits." }, { status: 400 });
  const identities = new Set(parsed.data.operations.map((row) => `${row.segment_type}\u0000${row.business_ref}`));
  if (identities.size !== parsed.data.operations.length) return Response.json({ code: "DUPLICATE_BUSINESS", message: safeWriteMessages.DUPLICATE_BUSINESS }, { status: 400 });
  const { data, error } = await authorization.service.rpc("set_field_business_erp_baselines_v1", {
    p_actor_id: authorization.actorId,
    p_rows: parsed.data.operations,
  });
  if (error) return Response.json({ code: "ERP_BASELINE_WRITE_FAILED", message: "No ERP edits were saved. Try again." }, { status: 503 });
  const result = data as { success?: boolean; code?: string } | null;
  if (!result?.success) {
    const code = result?.code ?? "ERP_BASELINE_WRITE_FAILED";
    return Response.json({ code, message: safeWriteMessages[code] ?? "No ERP edits were saved. Review the selections and try again." }, { status: code === "ADMIN_REQUIRED" ? 403 : 409 });
  }
  return Response.json({ success: true, result }, { headers: { "Cache-Control": "no-store" } });
}
