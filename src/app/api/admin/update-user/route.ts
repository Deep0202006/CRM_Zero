import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "BUILD_TIME_PLACEHOLDER_KEY"
);

const UpdateUserSchema = z.object({
  user_id: z.string().uuid(),
  email: z.string().min(3, "Email/Username is required"),
  name: z.string().min(2, "Name is required"),
  is_active: z.boolean(),
});

export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY === "BUILD_TIME_PLACEHOLDER_KEY") {
    return NextResponse.json({ error: "Server Configuration Error: SUPABASE_SERVICE_ROLE_KEY is missing in Vercel Environment Variables. Please add it in Vercel settings and redeploy." }, { status: 500 });
  }

  const { data: { user: caller }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !caller) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

  const { data: callerCaps } = await supabaseAdmin
    .from("user_capabilities").select("capability_code").eq("user_id", caller.id);
  const isAdmin = callerCaps?.some((c: any) => c.capability_code === "admin");
  if (!isAdmin) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const parsed = UpdateUserSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { user_id, email, name, is_active } = parsed.data;

  const { data: existingUser } = await supabaseAdmin.auth.admin.getUserById(user_id);
  const currentMeta = existingUser?.user?.user_metadata || {};

  const updatePayload: any = {
    email_confirm: true,
    user_metadata: { ...currentMeta, name }
  };
  
  if (existingUser?.user?.email !== email) {
    updatePayload.email = email;
  }

  // 1. Update Supabase Auth email (this handles both the login email and triggers confirmation if needed based on project settings)
  const { error: authUpdateError } = await supabaseAdmin.auth.admin.updateUserById(user_id, updatePayload);
  
  if (authUpdateError) {
    return NextResponse.json({ error: `Failed to update auth user: ${authUpdateError.message}` }, { status: 400 });
  }

  // 2. Update public.users - is_active is a boolean in the schema
  const { error: dbError } = await supabaseAdmin
    .from("users")
    .update({ name, email, is_active })
    .eq("user_id", user_id);

  if (dbError) {
    return NextResponse.json({ error: `Failed to update user profile: ${dbError.message}` }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}
