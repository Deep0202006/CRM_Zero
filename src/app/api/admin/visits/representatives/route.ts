import { z } from "zod";
import { createServerServiceClient, backendUnavailableResponse } from "@/lib/serverBackendEnvironment";
import { boundedReportJson, createReportResource, ReportUnavailable } from "@/lib/analytics/reportResource";
import { visitUuid } from "@/lib/fieldVisits/range";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const cursorName = z.string().refine((value) => [...value].length <= 1000); // PostgreSQL length/left count characters, not UTF-16 units.
const input = z.object({ search: z.string().trim().max(160).default(""), after_name: cursorName.optional(), after_id: visitUuid.optional(), selected: visitUuid.optional() }).strict();
const member = z.object({ user_id: visitUuid, name: z.string().nullable(), email: z.string().nullable(), is_active: z.boolean(), historical_only: z.boolean(), cursor_name: cursorName });
const output = z.object({ items: z.array(member).max(25), selected: member.nullable(), has_more: z.boolean() });
const fail = (status: number, code: string) => Response.json({ code }, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  const resource = createReportResource(request.signal, 4);
  try {
    resource.check();
    const backend = createServerServiceClient({ fetch: resource.fetch });
    if (!backend.ok) return backendUnavailableResponse();
    const authorization = request.headers.get("authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) return fail(401, "AUTH_REQUIRED");
    const { data, error } = await backend.client.auth.getUser(authorization.slice(7).trim());
    resource.check();
    if (error || !data.user) return fail(401, "AUTH_REQUIRED");
    const [profile, caps] = await Promise.all([
      resource.read(backend.client.from("users").select("is_active").eq("user_id", data.user.id).limit(2), true),
      resource.read(backend.client.from("user_capabilities").select("capability_code").eq("user_id", data.user.id).eq("capability_code", "admin").limit(1), true),
    ]);
    if (profile.error || caps.error || profile.data?.length !== 1 || profile.data[0].is_active !== true || !caps.data?.some((cap) => cap.capability_code === "admin")) return fail(403, "ADMIN_REQUIRED");
    const params = new URL(request.url).searchParams;
    const parsed = input.safeParse(Object.fromEntries(params));
    if (!parsed.success || [...params.keys()].some((key) => params.getAll(key).length !== 1)
      || (parsed.data.after_name === undefined) !== (parsed.data.after_id === undefined)) return fail(400, "INVALID_REPRESENTATIVE_SCOPE");
    const scope = parsed.data;
    const result = await resource.read(backend.client.rpc("crm_visit_representatives_v1", {
      p_search: scope.search, p_after_name: scope.after_name ?? null, p_after_id: scope.after_id ?? null, p_selected: scope.selected ?? null,
    }));
    if (result.error) throw new ReportUnavailable(result.error.code === "PGRST202" ? "VISIT_READER_ACTIVATION_REQUIRED" : "REPRESENTATIVES_UNAVAILABLE");
    const page = output.parse(result.data);
    if (new Set(page.items.map((item) => item.user_id)).size !== page.items.length || (page.has_more && page.items.length !== 25)
      || (page.selected && page.selected.user_id !== scope.selected)) throw new ReportUnavailable("REPRESENTATIVE_SCOPE_MISMATCH");
    const last = page.items.at(-1);
    resource.check();
    return boundedReportJson({ ...page, scope, next_cursor: page.has_more && last ? { after_name: last.cursor_name, after_id: last.user_id } : null,
      membership: "current-field-capability-or-retained-visit-including-inactive", generated_at: new Date().toISOString(), diagnostics: resource.diagnostics }, 65536);
  } catch (error) {
    return fail(503, error instanceof ReportUnavailable ? error.message : "REPRESENTATIVES_UNAVAILABLE");
  } finally { resource.finish(); }
}
