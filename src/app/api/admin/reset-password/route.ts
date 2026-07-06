import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "BUILD_TIME_PLACEHOLDER_KEY"
);

const ResetPasswordSchema = z.object({
  user_id: z.string().uuid("Invalid user ID"),
});

function generatePassword() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: { user: caller }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !caller) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

  const { data: callerCaps } = await supabaseAdmin
    .from("user_capabilities").select("capability_code").eq("user_id", caller.id);
  const isAdmin = callerCaps?.some((c: any) => c.capability_code === "admin");
  if (!isAdmin) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const parsed = ResetPasswordSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { user_id } = parsed.data;

  const tempPassword = generatePassword();
  const { data, error } = await supabaseAdmin.auth.admin.updateUserById(user_id, {
    password: tempPassword,
    user_metadata: { must_change_password: true }
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ tempPassword });
}
