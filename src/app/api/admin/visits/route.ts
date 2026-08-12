import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getCurrentISTDate, getISTBusinessDayBounds, isValidISTDateKey } from "@/lib/dateTime";
import { buildRepresentativeDirectory, type RepresentativeDirectoryRow } from "@/lib/fieldVisits/representatives";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;
const DIRECTORY_PAGE_SIZE = 1000;
const DIRECTORY_CACHE_TTL_MS = 60_000;
let directoryCache: { expiresAt: number; value: RepresentativeDirectoryRow[] } | null = null;
let directoryLoadInFlight: Promise<RepresentativeDirectoryRow[]> | null = null;

function errorResponse(status: number, message: string) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7).trim() || null : null;
}

async function loadHistoricalRepresentativeIds(admin: SupabaseClient) {
  const ids = new Set<string>();
  for (let from = 0; ; from += DIRECTORY_PAGE_SIZE) {
    const { data, error } = await admin
      .from("field_visits")
      .select("user_id")
      .order("visit_id", { ascending: true })
      .range(from, from + DIRECTORY_PAGE_SIZE - 1);
    if (error) throw Object.assign(new Error("representative visits query failed"), { safeCode: error.code ?? "UNKNOWN" });
    for (const row of (data ?? []) as Array<{ user_id: string }>) ids.add(row.user_id);
    if (!data || data.length < DIRECTORY_PAGE_SIZE) return [...ids];
  }
}

async function loadRepresentativeDirectoryUncached(admin: SupabaseClient) {
  const historicalIdsPromise = loadHistoricalRepresentativeIds(admin);
  const capabilityRows: Array<{ user_id: string; capability_code: string }> = [];
  for (let from = 0; ; from += DIRECTORY_PAGE_SIZE) {
    const { data, error } = await admin.from("user_capabilities")
      .select("user_id,capability_code")
      .in("capability_code", ["field_ret", "field_dist"])
      .order("user_id", { ascending: true })
      .range(from, from + DIRECTORY_PAGE_SIZE - 1);
    if (error) throw Object.assign(new Error("representative capability query failed"), { safeCode: error.code ?? "UNKNOWN" });
    capabilityRows.push(...((data ?? []) as typeof capabilityRows));
    if (!data || data.length < DIRECTORY_PAGE_SIZE) break;
  }
  const historicalIds = await historicalIdsPromise;
  const directoryIds = [...new Set([...capabilityRows.map((row) => row.user_id), ...historicalIds])];
  if (!directoryIds.length) return [];
  const users: Array<{ user_id: string; name: string; email: string; is_active: boolean | number | string }> = [];
  for (let index = 0; index < directoryIds.length; index += 100) {
    const { data, error } = await admin
      .from("users")
      .select("user_id,name,email,is_active")
      .in("user_id", directoryIds.slice(index, index + 100));
    if (error) {
      throw Object.assign(new Error("representative users query failed"), { safeCode: error.code ?? "UNKNOWN" });
    }
    users.push(...((data ?? []) as typeof users));
  }
  return buildRepresentativeDirectory(
    users,
    capabilityRows,
    historicalIds,
  );
}

async function loadRepresentativeDirectory(admin: SupabaseClient) {
  const now = Date.now();
  if (directoryCache && directoryCache.expiresAt > now) {
    return directoryCache.value.map((row) => ({ ...row, capabilities: [...row.capabilities] }));
  }
  if (!directoryLoadInFlight) {
    directoryLoadInFlight = loadRepresentativeDirectoryUncached(admin)
      .then((rows) => rows.map((row) => ({ ...row, capabilities: [...row.capabilities] })))
      .then((value) => {
        directoryCache = { expiresAt: Date.now() + DIRECTORY_CACHE_TTL_MS, value };
        return value;
      })
      .finally(() => {
        directoryLoadInFlight = null;
      });
  }
  const value = await directoryLoadInFlight;
  return value.map((row) => ({ ...row, capabilities: [...row.capabilities] }));
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
    const requestedDate = url.searchParams.get("date") ?? "";
    const date = isValidISTDateKey(requestedDate) ? requestedDate : "";
    const requestedFrom = url.searchParams.get("date_from") ?? "";
    const requestedTo = url.searchParams.get("date_to") ?? "";
    const dateFrom = isValidISTDateKey(requestedFrom) ? requestedFrom : "";
    const dateTo = isValidISTDateKey(requestedTo) ? requestedTo : "";
    const representative = url.searchParams.get("representative");
    const segment = url.searchParams.get("segment");
    const outcome = url.searchParams.get("outcome");
    const search = (url.searchParams.get("search") ?? "").trim();
    const selectedBounds = date ? getISTBusinessDayBounds(date) : null;
    let searchClauses: string[] = [];

    let query = admin
      .from("field_visits")
      .select("visit_id,user_id,lead_id,visit_date,check_in_time,check_in_lat,check_in_lng,address,selfie_storage_path,selfie_uploaded_at,selfie_purged_at,visit_outcome,visit_notes,person_met,segment_type,follow_up_date,sync_status,created_at,updated_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
    if (date && selectedBounds) query = query.or(`visit_date.eq.${date},and(check_in_time.gte.${selectedBounds.startsAt},check_in_time.lt.${selectedBounds.endsAt})`);
    if (!date && dateFrom) query = query.gte("visit_date", dateFrom);
    if (!date && dateTo) query = query.lte("visit_date", dateTo);
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
        searchClauses = [
          `visit_notes.ilike.%${safeSearch}%`,
          `person_met.ilike.%${safeSearch}%`,
          `address.ilike.%${safeSearch}%`,
          ...(matchingUsers?.length ? [`user_id.in.(${matchingUsers.map((row) => row.user_id).join(",")})`] : []),
          ...(matchingLeads?.length ? [`lead_id.in.(${matchingLeads.map((row) => `"${row.lead_id}"`).join(",")})`] : []),
        ];
        query = query.or(searchClauses.join(","));
      }
    }

    let representatives;
    try {
      representatives = await loadRepresentativeDirectory(admin);
    } catch (directoryError) {
      const safeCode = (directoryError as { safeCode?: string }).safeCode ?? "UNKNOWN";
      console.error("Admin visit representative directory failed", { code: safeCode });
      return errorResponse(503, "Representative directory is temporarily unavailable.");
    }

    const { data: rawVisits, error, count } = await query;
    if (error) return errorResponse(500, `Unable to load field visits (${error.code ?? "UNKNOWN"}).`);
    const visitsPage = (rawVisits ?? []) as Array<Record<string, unknown> & { user_id: string; lead_id: string }>;
    const userIds = [...new Set(visitsPage.map((visit) => visit.user_id).filter(Boolean))];
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const leadIds = [...new Set(visitsPage.map((visit) => visit.lead_id).filter((id) => uuidPattern.test(id)))];
    const [{ data: visitUsers, error: visitUsersError }, { data: visitLeads, error: visitLeadsError }] = await Promise.all([
      userIds.length ? admin.from("users").select("user_id,name,email").in("user_id", userIds) : Promise.resolve({ data: [], error: null }),
      leadIds.length ? admin.from("leads").select("lead_id,business_name,contact_person").in("lead_id", leadIds) : Promise.resolve({ data: [], error: null }),
    ]);
    if (visitUsersError) return errorResponse(500, "Unable to load representative identities.");
    if (visitLeadsError) console.error("Admin visit lead directory failed", { code: visitLeadsError.code ?? "UNKNOWN" });
    const usersById = new Map((visitUsers ?? []).map((user) => [user.user_id, user]));
    const leadsById = new Map((visitLeads ?? []).map((lead) => [lead.lead_id, lead]));
    const visits = visitsPage.map((visit) => ({
      visit_id: visit.visit_id,
      user_id: visit.user_id,
      lead_id: visit.lead_id,
      visit_date: visit.visit_date,
      check_in_time: visit.check_in_time,
      check_in_lat: visit.check_in_lat,
      check_in_lng: visit.check_in_lng,
      address: visit.address,
      visit_outcome: visit.visit_outcome,
      visit_notes: visit.visit_notes,
      person_met: visit.person_met,
      segment_type: visit.segment_type,
      follow_up_date: visit.follow_up_date,
      created_at: visit.created_at,
      updated_at: visit.updated_at,
      sync_status: visit.sync_status,
      selfie_uploaded_at: visit.selfie_uploaded_at,
      selfie_purged_at: visit.selfie_purged_at,
      has_selfie_evidence: Boolean(visit.selfie_storage_path) && !visit.selfie_purged_at,
      selfie_status: visit.selfie_purged_at ? "PURGED" : visit.selfie_storage_path ? "AVAILABLE" : "PENDING",
      confirmation_status: visit.selfie_purged_at ? "Selfie expired after 5-day retention" : visit.selfie_storage_path ? "Confirmed" : "Evidence pending",
      users: usersById.get(visit.user_id) ?? null,
      leads: leadsById.get(visit.lead_id) ?? null,
    }));

    let allTimeCountQuery = admin.from("field_visits").select("visit_id", { count: "exact", head: true });
    const today = getCurrentISTDate();
    const todayBounds = getISTBusinessDayBounds(today);
    let todayCountQuery = admin.from("field_visits").select("visit_id", { count: "exact", head: true }).or(`visit_date.eq.${today},and(check_in_time.gte.${todayBounds.startsAt},check_in_time.lt.${todayBounds.endsAt})`);
    for (const apply of [
      (q: typeof allTimeCountQuery) => representative && representative !== "ALL" ? q.eq("user_id", representative) : q,
      (q: typeof allTimeCountQuery) => segment && segment !== "ALL" ? q.eq("segment_type", segment) : q,
      (q: typeof allTimeCountQuery) => outcome && outcome !== "ALL" ? q.eq("visit_outcome", outcome) : q,
    ]) {
      allTimeCountQuery = apply(allTimeCountQuery);
      todayCountQuery = apply(todayCountQuery);
    }
    let legacyMismatchQuery = admin.from("field_visits").select("visit_id", { count: "exact", head: true });
    if (date && selectedBounds) {
      legacyMismatchQuery = legacyMismatchQuery.or(`visit_date.is.null,visit_date.neq.${date}`).gte("check_in_time", selectedBounds.startsAt).lt("check_in_time", selectedBounds.endsAt);
      if (representative && representative !== "ALL") legacyMismatchQuery = legacyMismatchQuery.eq("user_id", representative);
      if (segment && segment !== "ALL") legacyMismatchQuery = legacyMismatchQuery.eq("segment_type", segment);
      if (outcome && outcome !== "ALL") legacyMismatchQuery = legacyMismatchQuery.eq("visit_outcome", outcome);
      if (searchClauses.length) legacyMismatchQuery = legacyMismatchQuery.or(searchClauses.join(","));
    }
    const [{ count: allTimeTotal, error: allTimeError }, { count: todayTotal, error: todayError }, legacyResult] = await Promise.all([
      allTimeCountQuery,
      todayCountQuery,
      date ? legacyMismatchQuery : Promise.resolve({ count: 0, error: null }),
    ]);
    if (allTimeError || todayError || legacyResult.error) return errorResponse(500, "Unable to load visit metrics.");
    return NextResponse.json(
      {
        visits: [...new Map((visits ?? []).map((visit) => [visit.visit_id, visit])).values()],
        page,
        page_size: PAGE_SIZE,
        total: count ?? 0,
        all_time_total: allTimeTotal ?? 0,
        today_total: todayTotal ?? 0,
        has_more: page * PAGE_SIZE < (count ?? 0),
        date,
        date_from: dateFrom,
        date_to: dateTo,
        legacy_date_mismatch_count: legacyResult.count ?? 0,
        representatives,
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch {
    return errorResponse(500, "Unable to load field visits.");
  }
}
