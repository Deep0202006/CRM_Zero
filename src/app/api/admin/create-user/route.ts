import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "BUILD_TIME_PLACEHOLDER_KEY"
);

const VALID_CAPABILITIES = [
  "admin", "task_assigner", "dist_onboarding", "dist_support", "ret_onboarding",
  "ret_support", "field_dist", "field_ret", "tech_support",
] as const;

const CreateUserSchema = z.object({
  email: z.string().min(3, "Email/Username is required"),
  name: z.string().min(2, "Name is required"),
  password: z.string().min(6, "Password must be at least 6 characters").optional(),
  capabilities: z.array(z.enum(VALID_CAPABILITIES)).min(1, "Select at least one role"),
  manager_id: z.string().uuid().nullable().optional(),
});

function generatePassword() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

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

  const parsed = CreateUserSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { email, name, password, capabilities, manager_id } = parsed.data;

  // Strict format validation for non-admin accounts
  const isExempt = capabilities.includes('admin') || 
                   name.toLowerCase() === 'system administrator' || 
                   name.toLowerCase() === 'prince';

  if (!isExempt) {
    const formatRegex = /^zerodata\d+_[a-zA-Z0-9]+$/;
    if (!formatRegex.test(email)) {
      return NextResponse.json({ error: "Username must be provided manually and strictly follow the format: zerodata<empno>_<name> (e.g., zerodata501_Deep)" }, { status: 400 });
    }
  }

  const tempPassword = password || generatePassword();
  
  // Dummy Email Pattern to bypass Supabase's strict email formatting requirement
  const authEmail = email.includes('@') ? email.toLowerCase() : `${email.toLowerCase()}@zerodata.local`;
  
  const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email: authEmail, password: tempPassword, email_confirm: true,
    user_metadata: { name, must_change_password: true },
  });
  if (createError) return NextResponse.json({ error: createError.message }, { status: 400 });

  // Use upsert so it doesn't conflict with DB trigger if it fires first
  const { error: dbError } = await supabaseAdmin.from("users").upsert({
    user_id: newUser.user.id, name, email, is_active: true, manager_id: manager_id || null,
  });

  if (dbError) {
    // Transactional fallback: Delete auth user if public profile insertion fails
    await supabaseAdmin.auth.admin.deleteUser(newUser.user.id);
    return NextResponse.json({ error: `Failed to create public profile. Auth user rolled back. Reason: ${dbError.message}` }, { status: 400 });
  }

  await supabaseAdmin.from("user_capabilities").insert(
    capabilities.map((cap) => ({ user_id: newUser.user.id, capability_code: cap }))
  );

  return NextResponse.json({ email, tempPassword, name });
}
