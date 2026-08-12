import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!url || !key) return NextResponse.json({ error: "Evidence access is not configured." }, { status: 500 });
  if (!token) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: authData } = await admin.auth.getUser(token);
  if (!authData.user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  const [{ data: account, error: accountError }, { data: capabilities, error: capabilityError }] = await Promise.all([
    admin.from("users").select("is_active").eq("user_id", authData.user.id).maybeSingle(),
    admin.from("user_capabilities").select("capability_code").eq("user_id", authData.user.id),
  ]);
  const active = account?.is_active === true || account?.is_active === 1;
  if (accountError || capabilityError || !active ||
      !(capabilities ?? []).some((capability) => capability.capability_code === "admin")) {
    return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
  }

  const visitId = new URL(request.url).searchParams.get("visit_id");
  if (!visitId) return NextResponse.json({ error: "Visit ID is required." }, { status: 400 });
  const { data: visit, error } = await admin
    .from("field_visits")
    .select("selfie_storage_path,selfie_purged_at")
    .eq("visit_id", visitId)
    .maybeSingle();
  if (visit?.selfie_purged_at) {
    return NextResponse.json({ status: "PURGED", message: "Selfie captured. Expired after 5-day retention." }, { status: 410, headers: { "Cache-Control": "no-store" } });
  }
  if (error || !visit?.selfie_storage_path) {
    return NextResponse.json({ error: "Evidence is unavailable." }, { status: 404 });
  }
  const { data, error: signedError } = await admin.storage
    .from("visits-evidence")
    .createSignedUrl(visit.selfie_storage_path, 300);
  if (signedError || !data?.signedUrl) {
    return NextResponse.json({ error: "Evidence is unavailable." }, { status: 404 });
  }
  return NextResponse.json({ url: data.signedUrl }, { headers: { "Cache-Control": "no-store" } });
}
