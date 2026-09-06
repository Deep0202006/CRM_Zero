import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isValidISTDateKey } from "@/lib/dateTime";
import { backendUnavailableResponse, createServerAnonClient, createServerServiceClient } from "@/lib/serverBackendEnvironment";
import type { AttendanceAuthorityRow } from "@/lib/attendance/authority";
import { isAttendanceEligible } from "@/lib/attendance/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function active(value: unknown) { return value === true || value === 1 || (typeof value === "string" && ["1", "true", "t"].includes(value.toLowerCase())); }
function fail(status: number, code: string) { return NextResponse.json({ code }, { status, headers: { "Cache-Control": "no-store" } }); }

async function readRegister(service: SupabaseClient, dateFrom: string, dateTo: string) {
  const limit = 1000;
  const [users, capabilities, attendance] = await Promise.all([
    service.from("users").select("user_id,name,is_active", { count: "exact" }).eq("is_active", true).order("user_id").range(0, limit - 1),
    service.from("user_capabilities").select("user_id,capability_code", { count: "exact" }).order("user_id").range(0, limit - 1),
    service.from("attendance").select("attendance_id,user_id,date,clock_in,clock_out,latitude,longitude,selfie_captured,selfie_storage_path,selfie_uploaded_at,selfie_purged_at,selfie_purge_state", { count: "exact" }).gte("date", dateFrom).lte("date", dateTo).order("clock_in").order("attendance_id").range(0, limit - 1),
  ]);
  const error = users.error ?? capabilities.error ?? attendance.error;
  if (error) return { error };
  if ((users.count ?? 0) > limit || (capabilities.count ?? 0) > limit || (attendance.count ?? 0) > limit) return { error: new Error("ATTENDANCE_REGISTER_LIMIT_EXCEEDED") };
  return {
    users: (users.data ?? []) as Array<{ user_id: string; name: string; is_active: unknown }>,
    capabilities: (capabilities.data ?? []) as Array<{ user_id: string; capability_code: string }>,
    attendance: (attendance.data ?? []) as AttendanceAuthorityRow[],
  };
}

export async function GET(request: NextRequest) {
  const userResult = createServerAnonClient(), serviceResult = createServerServiceClient();
  if (!userResult.ok || !serviceResult.ok) return backendUnavailableResponse();
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return fail(401, "AUTHENTICATION_REQUIRED");
  const token = authorization.slice(7).trim();
  const dateFrom = request.nextUrl.searchParams.get("date_from") ?? "";
  const dateTo = request.nextUrl.searchParams.get("date_to") ?? "";
  if (!isValidISTDateKey(dateFrom) || !isValidISTDateKey(dateTo) || dateFrom > dateTo) return fail(400, "INVALID_ATTENDANCE_DATE");
  const rangeDays = Math.round((new Date(`${dateTo}T00:00:00Z`).getTime() - new Date(`${dateFrom}T00:00:00Z`).getTime()) / 86400000) + 1;
  if (rangeDays > 31) return fail(400, "ATTENDANCE_RANGE_TOO_LARGE");
  const userClient = userResult.client, service = serviceResult.client;
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
  const capabilitiesByUser = new Map<string, string[]>();
  for (const item of capabilities) capabilitiesByUser.set(item.user_id, [...(capabilitiesByUser.get(item.user_id) ?? []), item.capability_code]);
  const staff = users.filter((user) => isAttendanceEligible(capabilitiesByUser.get(user.user_id) ?? [])).sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({
    date_from: dateFrom,
    date_to: dateTo,
    users: staff.map((user) => ({ user_id: user.user_id, name: user.name, capabilities: capabilitiesByUser.get(user.user_id) ?? [] })),
    attendance: rows,
  }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
