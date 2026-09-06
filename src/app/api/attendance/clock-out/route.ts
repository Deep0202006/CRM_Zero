import { NextResponse } from "next/server";
import { getCurrentISTDate } from "@/lib/dateTime";
import { backendUnavailableResponse, createServerServiceClient } from "@/lib/serverBackendEnvironment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SELFIE_BYTES = 350 * 1024;
const SELFIE_TYPES = new Set(["image/jpeg", "image/webp"]);

async function hasValidImageSignature(file: File) {
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const jpeg = file.type === "image/jpeg" && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp =
    file.type === "image/webp" &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  return jpeg || webp;
}

function fail(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}

function bearerToken(request: Request) {
  const value = request.headers.get("authorization") ?? "";
  return value.startsWith("Bearer ") ? value.slice(7).trim() || null : null;
}

export async function POST(request: Request) {
  const serviceResult = createServerServiceClient();
  if (!serviceResult.ok) return backendUnavailableResponse();

  const token = bearerToken(request);
  if (!token) return fail(401, "Authentication required.");

  const admin = serviceResult.client;

  try {
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth.user) return fail(401, "Authentication required.");
    const userId = auth.user.id;

    const [{ data: account, error: accountError }, { data: capabilityRows, error: capabilityError }] =
      await Promise.all([
        admin.from("users").select("user_id,is_active").eq("user_id", userId).maybeSingle(),
        admin.from("user_capabilities").select("capability_code").eq("user_id", userId),
      ]);
    const active = account?.is_active === true || account?.is_active === 1;
    if (accountError || capabilityError || !account || !active) return fail(403, "Active account required.");

    const capabilities = new Set((capabilityRows ?? []).map((row) => row.capability_code));
    if (capabilities.has("admin")) {
      return NextResponse.json(
        { skipped: true, user_id: userId, reason: "admin" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const { data: attendance, error: attendanceError } = await admin
      .from("attendance")
      .select("attendance_id,user_id,clock_out")
      .eq("user_id", userId)
      .eq("date", getCurrentISTDate())
      .maybeSingle();
    if (attendanceError) return fail(500, "Unable to confirm today's attendance.");
    if (!attendance) return fail(404, "No attendance record was found for today.");
    const isFieldStaff = capabilities.has("field_ret") || capabilities.has("field_dist");
    if (isFieldStaff) {
      const contentType = request.headers.get("content-type") ?? "";
      if (!contentType.includes("multipart/form-data")) return fail(400, "A fresh logout selfie is required.");
      const form = await request.formData();
      const selfie = form.get("selfie");
      if (!(selfie instanceof File) || !SELFIE_TYPES.has(selfie.type) || selfie.size <= 0) {
        return fail(400, "A fresh JPEG or WebP logout selfie is required.");
      }
      if (selfie.size > MAX_SELFIE_BYTES) return fail(413, "The compressed logout selfie is too large.");
      if (!(await hasValidImageSignature(selfie))) return fail(400, "The logout selfie is not a valid image.");
      // Verification evidence is intentionally request-scoped and is never persisted or uploaded.
    }
    if (attendance.clock_out) {
      return NextResponse.json(attendance, { headers: { "Cache-Control": "no-store" } });
    }

    const clockOut = new Date().toISOString();
    const { data: confirmed, error: updateError } = await admin
      .from("attendance")
      .update({ clock_out: clockOut })
      .eq("attendance_id", attendance.attendance_id)
      .eq("user_id", userId)
      .is("clock_out", null)
      .select("attendance_id,user_id,clock_out")
      .maybeSingle();
    if (updateError) return fail(500, "Unable to confirm clock-out.");
    if (confirmed && confirmed.attendance_id === attendance.attendance_id && confirmed.user_id === userId && confirmed.clock_out) {
      return NextResponse.json(confirmed, { headers: { "Cache-Control": "no-store" } });
    }

    const { data: raced } = await admin
      .from("attendance")
      .select("attendance_id,user_id,clock_out")
      .eq("attendance_id", attendance.attendance_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (raced?.clock_out) return NextResponse.json(raced, { headers: { "Cache-Control": "no-store" } });
    return fail(409, "Clock-out was not confirmed. Please retry.");
  } catch {
    return fail(500, "Unable to complete clock-out.");
  }
}
