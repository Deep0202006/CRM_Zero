import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getCurrentISTDate } from "@/lib/dateTime";
import { resolvePaymentFollowUpIdentity } from "@/lib/fieldVisits/paymentFollowUps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const RESULT_LIMIT = 50;

function responseError(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return responseError(500, "Payment follow-up reminders are not configured.");
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
  if (!token) return responseError(401, "Authentication required.");

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) return responseError(401, "Authentication required.");
  const userId = authData.user.id;
  const { data: account, error: accountError } = await admin
    .from("users")
    .select("is_active")
    .eq("user_id", userId)
    .maybeSingle();
  if (accountError || !(account?.is_active === true || account?.is_active === 1)) {
    return responseError(403, "Active account required.");
  }

  const currentDate = getCurrentISTDate();
  const { data: visits, error: visitError } = await admin
    .from("field_visits")
    .select("visit_id,lead_id,follow_up_date,created_at")
    .eq("user_id", userId)
    .eq("segment_type", "Distributor")
    .eq("visit_outcome", "payment_follow_up")
    .eq("follow_up_date", currentDate)
    .order("created_at", { ascending: false })
    .limit(RESULT_LIMIT);
  if (visitError) return responseError(500, "Unable to load payment follow-up reminders.");

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const leadIds = [...new Set((visits ?? []).map((visit) => visit.lead_id).filter((id) => uuidPattern.test(id)))];
  const { data: leads, error: leadError } = leadIds.length
    ? await admin.from("leads").select("lead_id,business_name").in("lead_id", leadIds)
    : { data: [], error: null };
  if (leadError) console.error("Payment follow-up identity lookup failed", { code: leadError.code ?? "UNKNOWN" });
  const leadsById = new Map((leads ?? []).map((lead) => [lead.lead_id, lead]));
  const reminders = (visits ?? [])
    .map((visit) => resolvePaymentFollowUpIdentity(visit, leadsById.get(visit.lead_id) ?? null))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  return NextResponse.json(
    { date: currentDate, reminders },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
