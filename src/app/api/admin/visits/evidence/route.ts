import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const visitId = new URL(request.url).searchParams.get("visitId");
  if (!url || !anonKey) return NextResponse.json({ code: "SUPABASE_NOT_CONFIGURED" }, { status: 500 });
  if (!token) return NextResponse.json({ code: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  if (!visitId || !/^[0-9a-f-]{36}$/i.test(visitId)) {
    return NextResponse.json({ code: "INVALID_VISIT_ID" }, { status: 400 });
  }

  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData.user) return NextResponse.json({ code: "AUTHENTICATION_REQUIRED" }, { status: 401 });
  const { data: caps, error: capsError } = await client
    .from("user_capabilities").select("capability_code").eq("user_id", userData.user.id);
  if (capsError || !caps?.some((entry) => entry.capability_code === "admin")) {
    return NextResponse.json({ code: "ADMIN_REQUIRED" }, { status: 403 });
  }
  const { data: visit, error: visitError } = await client
    .from("field_visits").select("visit_id,user_id,visit_date,selfie_storage_path").eq("visit_id", visitId).single();
  if (visitError || !visit) return NextResponse.json({ code: "VISIT_NOT_FOUND" }, { status: 404 });
  const expected = `${visit.user_id}/${visit.visit_date}/${visit.visit_id}.jpg`;
  if (visit.selfie_storage_path !== expected) {
    return NextResponse.json({ code: "INVALID_EVIDENCE_PATH" }, { status: 409 });
  }
  const { data, error } = await client.storage.from("visits-evidence").createSignedUrl(expected, 300);
  if (error || !data?.signedUrl) return NextResponse.json({ code: "EVIDENCE_UNAVAILABLE" }, { status: 503 });
  return NextResponse.json({ signedUrl: data.signedUrl, expiresIn: 300 }, {
    headers: { "Cache-Control": "no-store, private" },
  });
}
