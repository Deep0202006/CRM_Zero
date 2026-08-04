import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as xlsx from "xlsx";
import { getISTBusinessDayBounds, isValidISTDateKey } from "@/lib/dateTime";
import { getOutcomeLabel } from "@/lib/fieldVisits/contract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const EXPORT_PAGE_SIZE = 500;

function jsonError(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

async function verifyAdmin(admin: SupabaseClient, token: string) {
  const { data: auth, error } = await admin.auth.getUser(token);
  if (error || !auth.user) return 401;
  const [{ data: user }, { data: capabilities, error: capabilityError }] = await Promise.all([
    admin.from("users").select("is_active").eq("user_id", auth.user.id).maybeSingle(),
    admin.from("user_capabilities").select("capability_code").eq("user_id", auth.user.id),
  ]);
  if (capabilityError || !(user?.is_active === true || user?.is_active === 1)) return 403;
  return (capabilities ?? []).some((row) => row.capability_code === "admin") ? 200 : 403;
}

export async function GET(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return jsonError(500, "Admin visit export is not configured.");
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return jsonError(401, "Authentication required.");
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const authorizationStatus = await verifyAdmin(admin, token);
  if (authorizationStatus !== 200) return jsonError(authorizationStatus, authorizationStatus === 401 ? "Authentication required." : "Administrator access required.");

  const url = new URL(request.url);
  const requestedDate = url.searchParams.get("date") ?? "";
  const date = isValidISTDateKey(requestedDate) ? requestedDate : "";
  const representative = url.searchParams.get("agent");
  const segment = url.searchParams.get("segment");
  const outcome = url.searchParams.get("outcome");
  const search = (url.searchParams.get("search") ?? "").trim();
  const selectedBounds = date ? getISTBusinessDayBounds(date) : null;
  let searchClauses: string[] = [];
  const safeSearch = search.replace(/[%_,().]/g, " ").trim();
  if (safeSearch) {
    const [{ data: matchingUsers }, { data: matchingLeads }] = await Promise.all([
      admin.from("users").select("user_id").or(`name.ilike.%${safeSearch}%,email.ilike.%${safeSearch}%`).limit(50),
      admin.from("leads").select("lead_id").or(`business_name.ilike.%${safeSearch}%,contact_person.ilike.%${safeSearch}%,phone.ilike.%${safeSearch}%`).limit(50),
    ]);
    searchClauses = [
      `visit_notes.ilike.%${safeSearch}%`,
      `person_met.ilike.%${safeSearch}%`,
      ...(matchingUsers?.length ? [`user_id.in.(${matchingUsers.map((row) => row.user_id).join(",")})`] : []),
      ...(matchingLeads?.length ? [`lead_id.in.(${matchingLeads.map((row) => `"${row.lead_id}"`).join(",")})`] : []),
    ];
  }
  const visits: Array<Record<string, unknown> & { visit_id: string; user_id: string; lead_id: string }> = [];
  for (let from = 0; ; from += EXPORT_PAGE_SIZE) {
    let query = admin.from("field_visits")
      .select("visit_id,user_id,lead_id,visit_date,check_in_time,segment_type,person_met,visit_outcome,visit_notes,follow_up_date,created_at")
      .order("created_at", { ascending: false })
      .order("visit_id", { ascending: false })
      .range(from, from + EXPORT_PAGE_SIZE - 1);
    if (date && selectedBounds) query = query.or(`visit_date.eq.${date},and(check_in_time.gte.${selectedBounds.startsAt},check_in_time.lt.${selectedBounds.endsAt})`);
    if (representative && representative !== "ALL") query = query.eq("user_id", representative);
    if (segment && segment !== "ALL") query = query.eq("segment_type", segment);
    if (outcome && outcome !== "ALL") query = query.eq("visit_outcome", outcome);
    if (searchClauses.length) query = query.or(searchClauses.join(","));
    const { data, error } = await query;
    if (error) return jsonError(500, "Unable to export field visits.");
    visits.push(...((data ?? []) as typeof visits));
    if (!data || data.length < EXPORT_PAGE_SIZE) break;
  }

  const uniqueVisits = [...new Map(visits.map((visit) => [visit.visit_id, visit])).values()];
  const userIds = [...new Set(uniqueVisits.map((visit) => visit.user_id))];
  const users = [];
  for (let index = 0; index < userIds.length; index += 100) {
    const { data, error } = await admin.from("users").select("user_id,name,email").in("user_id", userIds.slice(index, index + 100));
    if (error) return jsonError(500, "Unable to export representative identities.");
    users.push(...(data ?? []));
  }
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const leadIds = [...new Set(uniqueVisits.map((visit) => visit.lead_id).filter((id) => uuidPattern.test(id)))];
  const leads = [];
  for (let index = 0; index < leadIds.length; index += 100) {
    const { data, error } = await admin.from("leads").select("lead_id,business_name").in("lead_id", leadIds.slice(index, index + 100));
    if (error) return jsonError(500, "Unable to export business identities.");
    leads.push(...(data ?? []));
  }
  const usersById = new Map(users.map((user) => [user.user_id, user]));
  const leadsById = new Map(leads.map((lead) => [lead.lead_id, lead]));
  const rows = uniqueVisits.map((visit) => {
    const user = usersById.get(visit.user_id);
    const lead = leadsById.get(visit.lead_id);
    const checkIn = new Date(String(visit.check_in_time));
    return {
      "Visit ID": visit.visit_id,
      Representative: user?.name ?? `Unknown representative · ${visit.user_id.slice(0, 8)}`,
      "Representative email": user?.email ?? "Unavailable",
      "Visit date": visit.visit_date,
      "Check-in time": Number.isNaN(checkIn.getTime()) ? "Unavailable" : checkIn.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      Segment: visit.segment_type,
      Business: lead?.business_name ?? "Unavailable business",
      "Person met": visit.person_met ?? "",
      Outcome: getOutcomeLabel(String(visit.visit_outcome)),
      "Follow-up date": visit.follow_up_date ?? "",
      Notes: visit.visit_notes ?? "",
    };
  });
  const worksheet = xlsx.utils.json_to_sheet(rows);
  const workbook = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(workbook, worksheet, "Field Visits");
  const buffer = xlsx.write(workbook, { type: "buffer", bookType: "xlsx" });
  return new NextResponse(buffer, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="FieldVisitsExport_${date || "all"}.xlsx"`,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
  });
}
