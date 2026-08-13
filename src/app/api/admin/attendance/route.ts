import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { isValidISTDateKey } from "@/lib/dateTime";
import type { AttendanceAuthorityRow } from "@/lib/attendance/authority";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function client(url: string, key: string, token?: string): SupabaseClient {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, ...(token ? { global: { headers: { Authorization: `Bearer ${token}` } } } : {}) });
}
function active(value: unknown) { return value === true || value === 1 || (typeof value === "string" && ["1", "true", "t"].includes(value.toLowerCase())); }
function fail(status: number, code: string) { return NextResponse.json({ code }, { status, headers: { "Cache-Control": "no-store" } }); }

async function readRegister(service: SupabaseClient, dateFrom: string, dateTo: string) {
  const pageSize = 1000;
  const users: Array<{ user_id: string; name: string; is_active: unknown }> = [];
  const capabilities: Array<{ user_id: string; capability_code: string }> = [];
  const attendance: AttendanceAuthorityRow[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await service.from("users").select("user_id,name,is_active").eq("is_active", true).order("user_id").range(from, from + pageSize - 1);
    if (error) return { error };
    users.push(...(data ?? []));
    if ((data?.length ?? 0) < pageSize) break;
  }
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await service.from("user_capabilities").select("user_id,capability_code").order("user_id").range(from, from + pageSize - 1);
    if (error) return { error };
    capabilities.push(...(data ?? []));
    if ((data?.length ?? 0) < pageSize) break;
  }
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await service.from("attendance").select("attendance_id,user_id,date,clock_in,clock_out,latitude,longitude,selfie_captured,selfie_storage_path,selfie_uploaded_at,selfie_purged_at,selfie_purge_state").gte("date", dateFrom).lte("date", dateTo).order("clock_in").order("attendance_id").range(from, from + pageSize - 1);
    if (error) return { error };
    attendance.push(...((data ?? []) as AttendanceAuthorityRow[]));
    if ((data?.length ?? 0) < pageSize) break;
  }
  return { users, capabilities, attendance };
}

export async function GET(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !serviceKey || serviceKey === "BUILD_TIME_PLACEHOLDER_KEY") return fail(500, "SUPABASE_NOT_CONFIGURED");
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return fail(401, "AUTHENTICATION_REQUIRED");
  const token = authorization.slice(7).trim();
  const dateFrom = request.nextUrl.searchParams.get("date_from") ?? "";
  const dateTo = request.nextUrl.searchParams.get("date_to") ?? "";
  if (!isValidISTDateKey(dateFrom) || !isValidISTDateKey(dateTo) || dateFrom > dateTo) return fail(400, "INVALID_ATTENDANCE_DATE");
  const rangeDays = Math.round((new Date(`${dateTo}T00:00:00Z`).getTime() - new Date(`${dateFrom}T00:00:00Z`).getTime()) / 86400000) + 1;
  if (rangeDays > 31) return fail(400, "ATTENDANCE_RANGE_TOO_LARGE");
  const userClient = client(url, anon, token), service = client(url, serviceKey);
  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  if (authError || !authData.user) return fail(401, "AUTHENTICATION_REQUIRED");
  const [{ data: actor }, { data: actorCaps }] = await Promise.all([
    service.from("users").select("user_id,is_active").eq("user_id", authData.user.id).maybeSingle(),
    service.from("user_capabilities").select("capability_code").eq("user_id", authData.user.id),
  ]);
  if (!actor || !active(actor.is_active) || !(actorCaps ?? []).some((row) => row.capability_code === "admin")) return fail(403, "ADMIN_REQUIRED");
  const register = await readRegister(service, dateFrom, dateTo);
  if (register.error || !register.users || !register.capabilities || !register.attendance) return fail(502, "ATTENDANCE_AUTHORITY_UNAVAILABLE");
  const { users, capabilities, attendance: rows } = register;
  const adminIds = new Set(capabilities.filter((row) => row.capability_code === "admin").map((row) => row.user_id));
  const staff = users.filter((user) => !adminIds.has(user.user_id)).sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({
    date_from: dateFrom,
    date_to: dateTo,
    users: staff.map((user) => ({ user_id: user.user_id, name: user.name, capabilities: capabilities.filter((item) => item.user_id === user.user_id).map((item) => item.capability_code) })),
    attendance: rows,
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
