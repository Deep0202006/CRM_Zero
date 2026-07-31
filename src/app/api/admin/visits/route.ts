import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentISTDate } from "@/lib/dateTime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;

function errorResponse(status: number, message: string) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() || null : null;
}

export async function GET(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return errorResponse(500, "Admin visit reporting is not configured.");

  const token = getBearerToken(request);
  if (!token) return errorResponse(401, "Authentication required.");

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  try {
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    if (authError || !authData.user) return errorResponse(401, "Authentication required.");

    const [{ data: account }, { data: capabilities, error: capabilityError }] = await Promise.all([
      admin.from("users").select("is_active").eq("user_id", authData.user.id).maybeSingle(),
      admin.from("user_capabilities").select("capability_code").eq("user_id", authData.user.id),
    ]);
    const active = account?.is_active === true || account?.is_active === 1;
    if (capabilityError || !active) return errorResponse(403, "Administrator access required.");
    if (!(capabilities ?? []).some((capability) => capability.capability_code === "admin")) {
      return errorResponse(403, "Administrator access required.");
    }

    const url = new URL(request.url);
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("date") ?? "")
      ? url.searchParams.get("date")!
      : getCurrentISTDate();
    const representative = url.searchParams.get("representative");
    const segment = url.searchParams.get("segment");
    const outcome = url.searchParams.get("outcome");
    const search = (url.searchParams.get("search") ?? "").trim();

    let query = admin
      .from("field_visits")
      .select("*, users:user_id(name,email), leads:lead_id(business_name,contact_person,phone)", { count: "exact" })
      .eq("visit_date", date)
      .order("created_at", { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
    if (representative && representative !== "ALL") query = query.eq("user_id", representative);
    if (segment && segment !== "ALL") query = query.eq("segment_type", segment);
    if (outcome && outcome !== "ALL") query = query.eq("visit_outcome", outcome);
    if (search) {
      const safeSearch = search.replace(/[%_,().]/g, " ").trim();
      if (safeSearch) {
        const [{ data: matchingUsers }, { data: matchingLeads }] = await Promise.all([
          admin.from("users").select("user_id").or(`name.ilike.%${safeSearch}%,email.ilike.%${safeSearch}%`).limit(50),
          admin.from("leads").select("lead_id").or(`business_name.ilike.%${safeSearch}%,contact_person.ilike.%${safeSearch}%,phone.ilike.%${safeSearch}%`).limit(50),
        ]);
        const clauses = [
          `visit_notes.ilike.%${safeSearch}%`,
          `person_met.ilike.%${safeSearch}%`,
          ...(matchingUsers?.length ? [`user_id.in.(${matchingUsers.map((row) => row.user_id).join(",")})`] : []),
          ...(matchingLeads?.length ? [`lead_id.in.(${matchingLeads.map((row) => `"${row.lead_id}"`).join(",")})`] : []),
        ];
        query = query.or(clauses.join(","));
      }
    }

    const { data: visits, error, count } = await query;
    if (error) return errorResponse(500, "Unable to load field visits.");
    return NextResponse.json(
      {
        visits: visits ?? [],
        page,
        page_size: PAGE_SIZE,
        total: count ?? 0,
        has_more: page * PAGE_SIZE < (count ?? 0),
        date,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch {
    return errorResponse(500, "Unable to load field visits.");
  }
}
