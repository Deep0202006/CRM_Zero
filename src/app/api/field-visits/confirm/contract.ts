import { z } from "zod";
import {
  FIELD_VISIT_OUTCOMES,
  FIELD_VISIT_SEGMENTS,
  PincodeSchema,
} from "@/lib/fieldVisits/contract";
import { getCurrentISTDate, getISTDateKey, isValidISTDateKey } from "@/lib/dateTime";
import { canonicalErpIdSchema } from "@/lib/erp/validation";

const uuid = z.string().uuid();
const nullableDateTime = z.string().datetime({ offset: true }).nullable();

export const VisitConfirmationSchema = z.object({
  visit_id: uuid,
  lead_id: z.string().trim().min(1).max(250),
  user_id: uuid,
  visit_date: z.string().refine(isValidISTDateKey),
  check_in_time: z.string().datetime({ offset: true }),
  check_in_lat: z.number().finite().min(-90).max(90).nullable().optional(),
  check_in_lng: z.number().finite().min(-180).max(180).nullable().optional(),
  location_accuracy_m: z.number().finite().positive().max(10000).nullable().optional(),
  location_captured_at: nullableDateTime.optional(),
  location_acquisition_mode: z.enum(["gps", "high_accuracy", "balanced_fallback"]).nullable().optional(),
  location_quality: z.enum(["high", "medium", "good", "acceptable", "low"]).nullable().optional(),
  check_in_photo_url: z.string().max(1000).nullable().optional(),
  selfie_captured_at: nullableDateTime.optional(),
  selfie_capture_method: z.enum(["camera_or_upload", "live_camera", "file_fallback"]).nullable().optional(),
  selfie_storage_path: z.string().max(500).nullable().optional(),
  visit_outcome: z.enum(FIELD_VISIT_OUTCOMES),
  visit_notes: z.string().trim().max(2000).nullable().optional(),
  attendance_id: uuid.nullable().optional(),
  person_met: z.string().trim().min(2).max(120).nullable().optional(),
  address: z.string().trim().min(1).max(500).nullable().optional(),
  pincode: PincodeSchema.nullable().optional(),
  pincode_contract_version: z.literal(1).optional(),
  erp_contract_version: z.literal(1).optional(),
  erp_usage_state: z.enum(["erp", "none"]).nullable().optional(),
  erp_name_input: z.string().trim().max(160).nullable().optional(),
  erp_id: canonicalErpIdSchema.nullable().optional(),
  erp_name: z.string().trim().max(160).nullable().optional(),
  segment_type: z.enum(FIELD_VISIT_SEGMENTS),
  follow_up_date: z.string().refine(isValidISTDateKey).nullable().optional(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
}).superRefine((visit, ctx) => {
  if (getISTDateKey(visit.check_in_time) !== visit.visit_date) {
    ctx.addIssue({ code: "custom", path: ["visit_date"], message: "Visit date must match India check-in date" });
  }
  if (visit.follow_up_date && visit.follow_up_date < visit.visit_date) {
    ctx.addIssue({ code: "custom", path: ["follow_up_date"], message: "Follow-up date cannot precede visit date" });
  }
  if (["follow_up", "payment_follow_up"].includes(visit.visit_outcome) && !visit.follow_up_date) {
    ctx.addIssue({ code: "custom", path: ["follow_up_date"], message: "Follow-up date is required" });
  }
  if (visit.visit_outcome === "payment_follow_up" && visit.segment_type !== "Distributor") {
    ctx.addIssue({ code: "custom", path: ["visit_outcome"], message: "Payment follow-up requires Distributor segment" });
  }
  if (visit.visit_outcome === "payment_done" && visit.segment_type !== "Distributor") {
    ctx.addIssue({ code: "custom", path: ["visit_outcome"], message: "Payment done requires Distributor segment" });
  }
  if (visit.erp_contract_version === 1 && visit.erp_usage_state === "erp" && !visit.erp_name_input?.trim() && !visit.erp_name?.trim()) {
    ctx.addIssue({ code: "custom", path: ["erp_name_input"], message: "ERP name is required when ERP usage is selected" });
  }
});

export type VisitPayload = z.infer<typeof VisitConfirmationSchema>;
export type ConfirmationMode = "new" | "recovery";
export type SafeWarning = "BUSINESS_REFERENCE_WARNING" | "ATTENDANCE_LINK_PENDING" | "OPTIONAL_SCHEMA_MISMATCH";

export function validateNewVisit(visit: VisitPayload): boolean {
  return visit.visit_date === getCurrentISTDate()
    && Boolean(visit.person_met?.trim())
    && Boolean(visit.address?.trim())
    && Boolean(visit.pincode?.trim())
    && visit.check_in_lat !== null && visit.check_in_lat !== undefined
    && visit.check_in_lng !== null && visit.check_in_lng !== undefined
    && Boolean(visit.location_accuracy_m)
    && Boolean(visit.location_captured_at)
    && Boolean(visit.location_acquisition_mode)
    && Boolean(visit.location_quality)
    && (visit.erp_contract_version !== 1 || visit.erp_usage_state === "erp" || visit.erp_usage_state === "none");
}

export function validateLeadCompatibility(
  mode: ConfirmationMode,
  leadId: string,
  segment: string,
  lead: { lead_id: string; segment_type: string } | null,
): { allowed: boolean; warning?: SafeWarning } {
  if (lead && lead.segment_type !== segment) return { allowed: false };
  if (lead) return { allowed: true };
  return { allowed: Boolean(leadId.trim()), warning: "BUSINESS_REFERENCE_WARNING" };
}

export function resolveAttendanceId(
  rows: Array<{ attendance_id: string; user_id: string; date: string }>,
  submittedAttendanceId?: string | null,
): { attendanceId: string | null; integrityError: boolean } {
  if (rows.length > 1) return { attendanceId: null, integrityError: true };
  const submittedMatch = rows.find((row) => row.attendance_id === submittedAttendanceId);
  return { attendanceId: submittedMatch?.attendance_id ?? rows[0]?.attendance_id ?? null, integrityError: false };
}

export function coreRemotePayload(visit: VisitPayload, attendanceId: string | null) {
  return {
    visit_id: visit.visit_id,
    lead_id: visit.lead_id,
    user_id: visit.user_id,
    visit_date: visit.visit_date,
    check_in_time: visit.check_in_time,
    check_in_lat: visit.check_in_lat ?? null,
    check_in_lng: visit.check_in_lng ?? null,
    check_in_photo_url: visit.check_in_photo_url ?? null,
    visit_outcome: visit.visit_outcome,
    visit_notes: visit.visit_notes ?? null,
    attendance_id: attendanceId,
    person_met: visit.person_met ?? null,
    address: visit.address?.trim() ?? null,
    address_contract_version: 1,
    pincode: visit.pincode?.trim() ?? null,
    segment_type: visit.segment_type,
    follow_up_date: visit.follow_up_date ?? null,
    created_at: visit.created_at,
    updated_at: visit.updated_at,
  };
}

export function optionalRemotePayload(visit: VisitPayload) {
  return {
    location_accuracy_m: visit.location_accuracy_m ?? null,
    location_captured_at: visit.location_captured_at ?? null,
    location_acquisition_mode: visit.location_acquisition_mode ?? null,
    location_quality: visit.location_quality ?? null,
    selfie_captured_at: visit.selfie_captured_at ?? null,
    selfie_capture_method: visit.selfie_capture_method ?? null,
    selfie_storage_path: null,
  };
}

export function canonicalErpConfirmation(confirmed: {
  erp_id?: unknown;
  erp_usage_state?: unknown;
  erp_systems?: unknown;
}): { erp_id: string | null; erp_name: string | null; erp_usage_state: "erp" | "none" | null } {
  const relation = Array.isArray(confirmed.erp_systems) ? confirmed.erp_systems[0] : confirmed.erp_systems;
  const erpName = relation && typeof relation === "object" && "erp_name" in relation
    && typeof relation.erp_name === "string" ? relation.erp_name : null;
  return {
    erp_id: typeof confirmed.erp_id === "string" ? confirmed.erp_id : null,
    erp_name: erpName,
    erp_usage_state: confirmed.erp_usage_state === "erp" || confirmed.erp_usage_state === "none"
      ? confirmed.erp_usage_state : null,
  };
}

export function erpRemotePayload(visit: VisitPayload) {
  return {
    erp_contract_version: visit.erp_contract_version,
    erp_usage_state: visit.erp_usage_state,
    erp_name_input: visit.erp_name_input ?? visit.erp_name ?? null,
    erp_id: visit.erp_id ?? null,
  };
}
