import { getCurrentISTDate, getISTBusinessDayBounds } from "@/lib/dateTime";
import { backendUnavailableResponse, createServerServiceClient } from "@/lib/serverBackendEnvironment";
import { boundedReportJson, createReportResource, ReportUnavailable } from "@/lib/analytics/reportResource";
import { parseVisitRegister, visitRegisterResultSchema } from "@/lib/fieldVisits/range";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;
const projection = "visit_id,user_id,lead_id,visit_date,check_in_time,check_in_lat,check_in_lng,address,pincode,selfie_storage_path,selfie_uploaded_at,selfie_purged_at,visit_outcome,visit_notes,person_met,segment_type,follow_up_date,sync_status,created_at,updated_at,erp_id,erp_usage_state,erp_systems(erp_name)";
const errorResponse = (status: number, error: string) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  const resource = createReportResource(request.signal);
  try {
    resource.check();
    const backend = createServerServiceClient({ fetch: resource.fetch });
    if (!backend.ok) return backendUnavailableResponse();
    const admin = backend.client;
    const authorization = request.headers.get("authorization") ?? "";
    if (!authorization.startsWith("Bearer ")) return errorResponse(401, "Authentication required.");
    const { data: auth, error: authError } = await admin.auth.getUser(authorization.slice(7).trim());
    resource.check();
    if (authError || !auth.user) return errorResponse(401, "Authentication required.");
    const [account, caps] = await Promise.all([
      resource.read(admin.from("users").select("is_active").eq("user_id", auth.user.id).limit(2), true),
      resource.read(admin.from("user_capabilities").select("capability_code").eq("user_id", auth.user.id).eq("capability_code", "admin").limit(1), true),
    ]);
    if (account.error || caps.error || account.data?.length !== 1 || account.data[0].is_active !== true || !caps.data?.some((cap) => cap.capability_code === "admin")) return errorResponse(403, "Administrator access required.");
    let scope;
    try { scope = parseVisitRegister(new URL(request.url).searchParams, new Date().toISOString()); }
    catch { return errorResponse(400, "Invalid visit filters. Use a complete range of at most 31 days or a separate legacy date; pages 1–400."); }
    const { page, representative, segment, outcome, search } = scope;
    const date = scope.date ?? "", dateFrom = scope.date_from ?? "", dateTo = scope.date_to ?? "";
    const selectedBounds = date ? getISTBusinessDayBounds(date) : null;
    const matched = await resource.read(admin.rpc("crm_visit_register_v1", {
      p_from: dateFrom || null, p_to: dateTo || null, p_representative: representative,
      p_segment: segment, p_outcome: outcome, p_search: search, p_legacy_date: date || null, p_page: page,
    }));
    if (matched.error && matched.error.code !== "PGRST202") throw new ReportUnavailable("VISIT_REGISTER_UNAVAILABLE");
    const activationPending = Boolean(matched.error);
    // No capped identity lookup: absent joined SQL cannot establish complete search.
    if (activationPending && search) return errorResponse(503, "Joined visit search requires reader activation. Clear search to keep browsing confirmed records.");
    const exact = activationPending ? null : visitRegisterResultSchema.parse(matched.data);
    if (exact && exact.page !== page) throw new ReportUnavailable("VISIT_REGISTER_SCOPE_MISMATCH");
    let query = admin.from("field_visits").select(projection, { count: "exact" })
      .order("created_at", { ascending: false }).order("visit_id", { ascending: false });
    if (exact) query = query.in("visit_id", exact.visit_ids);
    else {
      query = query.range((page-1)*PAGE_SIZE, page*PAGE_SIZE-1);
      if (date && selectedBounds) query = query.or(`visit_date.eq.${date},and(check_in_time.gte.${selectedBounds.startsAt},check_in_time.lt.${selectedBounds.endsAt})`);
      if (dateFrom) query = query.gte("visit_date", dateFrom);
      if (dateTo) query = query.lte("visit_date", dateTo);
      if (representative) query = query.eq("user_id", representative);
      if (segment) query = query.eq("segment_type", segment);
      if (outcome) query = query.eq("visit_outcome", outcome);
    }
    const rows = exact?.visit_ids.length === 0 ? { data: [], error: null, count: 0 } : await resource.read(query);
    if (rows.error || rows.count === null) throw new ReportUnavailable("VISIT_RECORDS_UNAVAILABLE");
    const total = exact?.total ?? rows.count;
    const expected = Math.min(PAGE_SIZE, Math.max(0,total-(page-1)*PAGE_SIZE));
    if (rows.data?.length !== expected) throw new ReportUnavailable("VISIT_RECORDS_CHANGED_OR_LIMITED");
    const visitsPage = rows.data as Array<Record<string, unknown> & { visit_id: string; user_id: string; lead_id: string }>;
    if (exact && visitsPage.some((row,index) => row.visit_id !== exact.visit_ids[index])) throw new ReportUnavailable("VISIT_RECORDS_CHANGED_OR_LIMITED");
    const userIds = [...new Set(visitsPage.map((visit) => visit.user_id))];
    const uuidPattern = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
    const leadIds = [...new Set(visitsPage.map((visit) => visit.lead_id).filter((id) => uuidPattern.test(id)))];
    const [users, leads] = await Promise.all([
      userIds.length ? resource.read(admin.from("users").select("user_id,name,email").in("user_id",userIds).limit(50)) : { data: [], error: null },
      leadIds.length ? resource.read(admin.from("leads").select("lead_id,business_name,contact_person,phone", { count: "exact" }).in("lead_id",leadIds).limit(50)) : { data: [], error: null, count: 0 },
    ]);
    if (users.error || leads.error || users.data?.length !== userIds.length || leads.count === null || leads.data?.length !== leads.count) throw new ReportUnavailable("VISIT_IDENTITIES_UNAVAILABLE");
    const usersById = new Map((users.data ?? []).map((user) => [user.user_id,user]));
    const leadsById = new Map((leads.data ?? []).map((lead) => [lead.lead_id,lead]));
    const visits = visitsPage.map((visit) => ({
      visit_id:visit.visit_id,user_id:visit.user_id,lead_id:visit.lead_id,visit_date:visit.visit_date,
      check_in_time:visit.check_in_time,check_in_lat:visit.check_in_lat,check_in_lng:visit.check_in_lng,
      address:visit.address,pincode:visit.pincode,visit_outcome:visit.visit_outcome,visit_notes:visit.visit_notes,
      person_met:visit.person_met,segment_type:visit.segment_type,follow_up_date:visit.follow_up_date,
      erp_id:visit.erp_id,erp_usage_state:visit.erp_usage_state,
      erp_name:(visit.erp_systems as { erp_name?: string } | null)?.erp_name ?? null,
      created_at:visit.created_at,updated_at:visit.updated_at,sync_status:visit.sync_status,
      selfie_uploaded_at:visit.selfie_uploaded_at,selfie_purged_at:visit.selfie_purged_at,
      has_selfie_evidence:Boolean(visit.selfie_storage_path) && !visit.selfie_purged_at,
      selfie_status: visit.selfie_purged_at ? "PURGED" : visit.selfie_storage_path ? "AVAILABLE" : "PENDING",
      confirmation_status:visit.selfie_purged_at ? "Selfie expired after 5-day retention" : visit.selfie_storage_path ? "Confirmed" : "Evidence pending",
      users:usersById.get(visit.user_id) ?? null,leads:leadsById.get(visit.lead_id) ?? null,
    }));
    // Global context deliberately excludes range/search, as labeled by its consumer.
    let allTimeQuery = admin.from("field_visits").select("visit_id", { count:"exact",head:true });
    const today = getCurrentISTDate(), bounds = getISTBusinessDayBounds(today);
    let todayQuery = admin.from("field_visits").select("visit_id", { count:"exact",head:true })
      .or(`visit_date.eq.${today},and(check_in_time.gte.${bounds.startsAt},check_in_time.lt.${bounds.endsAt})`);
    for (const apply of [
      (q: typeof allTimeQuery) => representative ? q.eq("user_id",representative) : q,
      (q: typeof allTimeQuery) => segment ? q.eq("segment_type",segment) : q,
      (q: typeof allTimeQuery) => outcome ? q.eq("visit_outcome",outcome) : q,
    ]) { allTimeQuery=apply(allTimeQuery); todayQuery=apply(todayQuery); }
    const [allTime,todayCount] = await Promise.all([resource.read(allTimeQuery),resource.read(todayQuery)]);
    let mismatchCount = exact?.legacy_date_mismatch_count ?? 0;
    if (!exact && date && selectedBounds) {
      let mismatches = admin.from("field_visits").select("visit_id",{ count:"exact",head:true })
        .or(`visit_date.is.null,visit_date.neq.${date}`).gte("check_in_time",selectedBounds.startsAt).lt("check_in_time",selectedBounds.endsAt);
      if (representative) mismatches=mismatches.eq("user_id",representative);
      if (segment) mismatches=mismatches.eq("segment_type",segment);
      if (outcome) mismatches=mismatches.eq("visit_outcome",outcome);
      const result=await resource.read(mismatches);
      if (result.error || result.count===null) throw new ReportUnavailable("VISIT_MISMATCH_COUNT_UNAVAILABLE");
      mismatchCount=result.count;
    }
    resource.check();
    return boundedReportJson({ visits,scope,page,page_size:PAGE_SIZE,total,
      has_more:page*PAGE_SIZE<total,page_limit:400,pagination_limited:page===400 && page*PAGE_SIZE<total,
      all_time_total:allTime.error ? null : allTime.count,today_total:todayCount.error ? null : todayCount.count,
      date,date_from:dateFrom,date_to:dateTo,legacy_date_mismatch_count:mismatchCount,
      reader_activation:activationPending ? "pending" : "available",consistency:"bounded-live-multi-request",
      generated_at:new Date().toISOString(),diagnostics:resource.diagnostics,
    });
  } catch (error) {
    return errorResponse(503,error instanceof ReportUnavailable ? error.message : "Visit records are temporarily unavailable. Retry the same filters.");
  } finally { resource.finish(); }
}
