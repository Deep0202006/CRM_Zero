import { NextRequest, NextResponse } from "next/server";
import { createServerServiceClient } from "@/lib/serverBackendEnvironment";
import { UpdateSchema } from "./schema";

async function authorize(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  const serviceResult = createServerServiceClient();
  if (!serviceResult.ok) return NextResponse.json({ error: "BACKEND_UNAVAILABLE", reason: serviceResult.reason }, { status: 503 });
  const service = serviceResult.client;
  const { data } = await service.auth.getUser(token);
  if (!data.user) return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  const { data: capability } = await service
    .from("user_capabilities")
    .select("capability_code")
    .eq("user_id", data.user.id)
    .eq("capability_code", "admin")
    .maybeSingle();
  return capability ? { service, actorId: data.user.id } : NextResponse.json({ error: "Admin access required" }, { status: 403 });
}

export async function GET(request: NextRequest) {
  const authority = await authorize(request);
  if (authority instanceof NextResponse) return authority;
  const { service } = authority;
  const [capabilities, erps] = await Promise.all([
    service
      .from("user_capabilities")
      .select("user_id")
      .eq("capability_code", "erp_partner_viewer")
      .limit(500),
    service
      .from("erp_systems")
      .select("erp_id,erp_name,erp_key")
      .order("erp_name")
      .limit(500),
  ]);
  if (capabilities.error || erps.error)
    return NextResponse.json(
      { error: "ERP partner directory unavailable" },
      { status: 502 },
    );
  const userIds = (capabilities.data ?? []).map(
    (row: { user_id: string }) => row.user_id,
  );
  if (!userIds.length)
    return NextResponse.json({ users: [], erps: erps.data ?? [] });
  const [users, scopes] = await Promise.all([
    service
      .from("users")
      .select("user_id,name,email,is_active")
      .in("user_id", userIds)
      .limit(500),
    service
      .from("erp_partner_scopes")
      .select("user_id,erp_id")
      .in("user_id", userIds)
      .limit(5000),
  ]);
  if (users.error || scopes.error)
    return NextResponse.json(
      { error: "ERP partner scopes unavailable" },
      { status: 502 },
    );
  return NextResponse.json({
    users: (users.data ?? []).map(
      (user: {
        user_id: string;
        name: string;
        email: string;
        is_active: boolean;
      }) => ({
        ...user,
        erp_scope_ids: (scopes.data ?? [])
          .filter(
            (scope: { user_id: string; erp_id: string }) =>
              scope.user_id === user.user_id,
          )
          .map((scope: { user_id: string; erp_id: string }) => scope.erp_id),
      }),
    ),
    erps: erps.data ?? [],
  });
}

export async function POST(request: NextRequest) {
  const authority = await authorize(request);
  if (authority instanceof NextResponse) return authority;
  const parsed = UpdateSchema.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  const { data, error } = await authority.service.rpc(
    "set_erp_partner_scopes_v1",
    {
      p_user_id: parsed.data.user_id,
      p_erp_ids: parsed.data.erp_scope_ids,
      p_actor_id: authority.actorId,
    },
  );
  if (error)
    return NextResponse.json({ error: error.message }, { status: 409 });
  const result = data as { success?: boolean; code?: string } | null;
  if (!result?.success)
    return NextResponse.json(
      { error: result?.code ?? "ERP_SCOPE_REJECTED" },
      { status: 409 },
    );
  return NextResponse.json({ success: true });
}
