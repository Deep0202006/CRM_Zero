import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { backendUnavailableResponse, createServerServiceClient } from "@/lib/serverBackendEnvironment";

const ResetPasswordSchema = z.object({
  user_id: z.string().uuid("Invalid user ID"),
  password: z.string().min(6, "Password must be at least 6 characters").optional(),
});

function generatePassword() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

export async function POST(req: NextRequest) {
  const serviceResult = createServerServiceClient();
  if (!serviceResult.ok) return backendUnavailableResponse();
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const supabaseAdmin = serviceResult.client;

  const { data: { user: caller }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !caller) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

  const { data: callerCaps } = await supabaseAdmin
    .from("user_capabilities").select("capability_code").eq("user_id", caller.id);
  const isAdmin = callerCaps?.some((c: { capability_code: string }) => c.capability_code === "admin");
  if (!isAdmin) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const parsed = ResetPasswordSchema.safeParse(await req.json());
  if (!parsed.success) {
    const errorMsg = Object.values(parsed.error.flatten().fieldErrors).flat()[0] || "Invalid input";
    return NextResponse.json({ error: errorMsg }, { status: 400 });
  }
  const { user_id, password } = parsed.data;

  const tempPassword = password || generatePassword();
  const { error } = await supabaseAdmin.auth.admin.updateUserById(user_id, {
    password: tempPassword,
    user_metadata: { must_change_password: true },
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ tempPassword });
}
