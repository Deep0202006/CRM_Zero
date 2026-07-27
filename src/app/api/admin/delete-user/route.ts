import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "BUILD_TIME_PLACEHOLDER_KEY"
);

export async function DELETE(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY === "BUILD_TIME_PLACEHOLDER_KEY") {
    return NextResponse.json({ error: "Server Configuration Error: SUPABASE_SERVICE_ROLE_KEY is missing." }, { status: 500 });
  }

  const { data: { user: caller }, error: authError } = await supabaseAdmin.auth.getUser(token);
  if (authError || !caller) return NextResponse.json({ error: "Invalid session" }, { status: 401 });

  const { data: callerCaps } = await supabaseAdmin
    .from("user_capabilities").select("capability_code").eq("user_id", caller.id);
  
  const isAdmin = callerCaps?.some((c: { capability_code: string }) => c.capability_code === "admin");
  if (!isAdmin) return NextResponse.json({ error: "Admin access required" }, { status: 403 });

  const url = new URL(req.url);
  const user_id = url.searchParams.get("user_id");

  if (!user_id) {
    return NextResponse.json({ error: "user_id is required" }, { status: 400 });
  }

  // Attempt to delete user from Auth
  // Note: if there are restrictive foreign key constraints on public.users, this will fail.
  // The user requested: "delete a user permanently without affecting others"
  const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(user_id);
  
  if (deleteError) {
    return NextResponse.json({ error: `Failed to delete user: ${deleteError.message}` }, { status: 400 });
  }

  // The public.users record should cascade or be deleted by trigger. 
  // Just to be absolutely certain we clean up public.users if no trigger exists:
  await supabaseAdmin.from("users").delete().eq("user_id", user_id);

  return NextResponse.json({ success: true, message: "User deleted successfully" });
}
