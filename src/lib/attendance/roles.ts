export type AttendanceMode = "field_selfie" | "office_auto" | "admin_read_only" | "not_eligible";

const FIELD_CAPABILITIES = new Set(["field_dist", "field_ret"]);
const OFFICE_CAPABILITIES = new Set(["dist_onboarding", "ret_onboarding", "dist_support", "ret_support"]);

export function attendanceModeForCapabilities(capabilities: readonly string[]): AttendanceMode {
  if (capabilities.includes("admin")) return "admin_read_only";
  if (capabilities.some((capability) => FIELD_CAPABILITIES.has(capability))) return "field_selfie";
  if (capabilities.some((capability) => OFFICE_CAPABILITIES.has(capability))) return "office_auto";
  return "not_eligible";
}

export function isAttendanceEligible(capabilities: readonly string[]): boolean {
  const mode = attendanceModeForCapabilities(capabilities);
  return mode === "field_selfie" || mode === "office_auto";
}
