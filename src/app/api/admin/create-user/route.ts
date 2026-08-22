import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { canonicalErpIdSchema } from "@/lib/erp/validation";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "BUILD_TIME_PLACEHOLDER_KEY",
);

const VALID_CAPABILITIES = [
  "admin",
  "task_assigner",
  "dist_onboarding",
  "dist_support",
  "ret_onboarding",
  "ret_support",
  "field_dist",
  "field_ret",
  "tech_support",
  "erp_partner_viewer",
] as const;

export const CreateUserSchema = z
  .object({
    account_type: z.enum(["internal", "erp_partner"]),
    email: z.string().min(3, "Email/Username is required"),
    name: z.string().min(2, "Name is required"),
    phone: z.string().max(20, "Phone number is too long").optional().nullable(),
    password: z
      .string()
      .min(6, "Password must be at least 6 characters")
      .optional(),
    capabilities: z
      .array(z.enum(VALID_CAPABILITIES))
      .min(1, "Select at least one role"),
    erp_scope_ids: z.array(canonicalErpIdSchema).max(100).default([]),
    manager_id: z.string().uuid().nullable().optional(),
  })
  .superRefine((value, context) => {
    const isPartner = value.account_type === "erp_partner";
    if (
      isPartner &&
      (value.capabilities.length !== 1 ||
        value.capabilities[0] !== "erp_partner_viewer")
    ) {
      context.addIssue({
        code: "custom",
        path: ["capabilities"],
        message: "ERP Partner Viewer is an exclusive account type",
      });
    }
    if (isPartner && value.erp_scope_ids.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["erp_scope_ids"],
        message: "Select at least one ERP scope",
      });
    }
    if (!isPartner && value.capabilities.includes("erp_partner_viewer")) {
      context.addIssue({
        code: "custom",
        path: ["capabilities"],
        message:
          "ERP Partner Viewer cannot be mixed with internal capabilities",
      });
    }
    if (isPartner && value.manager_id) {
      context.addIssue({
        code: "custom",
        path: ["manager_id"],
        message: "External accounts do not have managers",
      });
    }
  });

function generatePassword() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token)
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  if (
    !process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY === "BUILD_TIME_PLACEHOLDER_KEY"
  ) {
    return NextResponse.json(
      {
        error:
          "Server Configuration Error: SUPABASE_SERVICE_ROLE_KEY is missing in Vercel Environment Variables. Please add it in Vercel settings and redeploy.",
      },
      { status: 500 },
    );
  }

  const {
    data: { user: caller },
    error: authError,
  } = await supabaseAdmin.auth.getUser(token);
  if (authError || !caller)
    return NextResponse.json({ error: "Invalid session" }, { status: 401 });

  const { data: callerCaps } = await supabaseAdmin
    .from("user_capabilities")
    .select("capability_code")
    .eq("user_id", caller.id);
  const isAdmin = callerCaps?.some(
    (c: { capability_code: string }) => c.capability_code === "admin",
  );
  if (!isAdmin)
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403 },
    );

  const parsed = CreateUserSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const {
    email,
    name,
    phone,
    password,
    capabilities,
    manager_id,
    erp_scope_ids,
  } = parsed.data;

  // Removing strict format validation as requested to allow arbitrary usernames like username_123
  // Users still require 3 characters minimum enforced by Zod schema

  const tempPassword = password || generatePassword();

  // Dummy Email Pattern to bypass Supabase's strict email formatting requirement
  const authEmail = email.includes("@")
    ? email.toLowerCase()
    : `${email.toLowerCase()}@zerodata.local`;

  const { data: newUser, error: createError } =
    await supabaseAdmin.auth.admin.createUser({
      email: authEmail,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { name, must_change_password: true },
    });
  if (createError)
    return NextResponse.json({ error: createError.message }, { status: 400 });

  // Use upsert so it doesn't conflict with DB trigger if it fires first
  const { error: dbError } = await supabaseAdmin.from("users").upsert({
    user_id: newUser.user.id,
    name,
    email,
    phone: phone || null,
    is_active: true,
    manager_id: manager_id || null,
  });

  if (dbError) {
    // Transactional fallback: Delete auth user if public profile insertion fails
    await supabaseAdmin.auth.admin.deleteUser(newUser.user.id);
    return NextResponse.json(
      {
        error: `Failed to create public profile. Auth user rolled back. Reason: ${dbError.message}`,
      },
      { status: 400 },
    );
  }

  const { error: capabilityError } = await supabaseAdmin
    .from("user_capabilities")
    .insert(
      capabilities.map((cap) => ({
        user_id: newUser.user.id,
        capability_code: cap,
      })),
    );

  let scopeError: { message: string } | null = null;
  if (!capabilityError && capabilities.includes("erp_partner_viewer")) {
    const result = await supabaseAdmin.rpc("set_erp_partner_scopes_v1", {
      p_user_id: newUser.user.id,
      p_erp_ids: erp_scope_ids,
      p_actor_id: caller.id,
    });
    const response = result.data as { success?: boolean; code?: string } | null;
    scopeError =
      result.error ??
      (response?.success
        ? null
        : { message: response?.code ?? "ERP_SCOPE_REJECTED" });
  }

  if (capabilityError || scopeError) {
    await supabaseAdmin.from("users").delete().eq("user_id", newUser.user.id);
    await supabaseAdmin.auth.admin.deleteUser(newUser.user.id);
    return NextResponse.json(
      {
        error: `Account provisioning rolled back. ${capabilityError?.message ?? scopeError?.message}`,
      },
      { status: 400 },
    );
  }

  return NextResponse.json({ email, tempPassword, name });
}
