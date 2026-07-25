import { z } from "zod";

export const FIELD_VISIT_SEGMENTS = [
  "Retailer",
  "Distributor"
] as const;

export type FieldVisitSegment = typeof FIELD_VISIT_SEGMENTS[number];

export const FIELD_VISIT_OUTCOMES = [
  "registered",
  "installed",
  "interested",
  "follow_up",
  "not_interested"
] as const;

export type FieldVisitOutcome = typeof FIELD_VISIT_OUTCOMES[number];

export function getOutcomeLabel(outcome: FieldVisitOutcome | string): string {
  switch (outcome) {
    case "registered": return "Registered";
    case "installed": return "Installed";
    case "interested": return "Interested";
    case "follow_up": return "Follow-up";
    case "not_interested": return "Not interested";
    default: return outcome; // Legacy fallback
  }
}

export function isFollowUpRequired(outcome: FieldVisitOutcome): boolean {
  return outcome === "follow_up";
}

export function areNotesRequired(outcome: FieldVisitOutcome): boolean {
  return outcome === "follow_up" || outcome === "not_interested";
}

export function isAuthorizedForSegment(segment: FieldVisitSegment, userCapabilities: string[]): boolean {
  if (segment === "Retailer") return userCapabilities.includes("field_ret");
  if (segment === "Distributor") return userCapabilities.includes("field_dist");
  return false;
}

export function classifyLocationQuality(accuracy: number): "good" | "acceptable" | "low" {
  if (accuracy <= 100) return "good";
  if (accuracy <= 250) return "acceptable";
  return "low";
}

export function generateEvidencePath(userId: string, visitDate: string, visitId: string): string {
  return `${userId}/${visitDate}/${visitId}.jpg`;
}

export function normalizeLegacyEvidencePath(rawPath: string | null): string | null {
  if (!rawPath) return null;
  const match = rawPath.match(/visits-evidence\/(.+)$/);
  return match ? match[1] : rawPath;
}

export const FieldVisitSchema = z.object({
  visit_id: z.string().uuid(),
  lead_id: z.string().min(1),
  user_id: z.string().uuid(),
  visit_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  check_in_time: z.string().datetime(),
  person_met: z.string().trim().min(2).max(120).optional().nullable(),
  visit_notes: z.string().max(2000).optional().nullable(),
  segment_type: z.enum(FIELD_VISIT_SEGMENTS),
  visit_outcome: z.enum(FIELD_VISIT_OUTCOMES),
  follow_up_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  check_in_lat: z.number().finite().nullable(),
  check_in_lng: z.number().finite().nullable(),
  location_accuracy_m: z.number().finite().positive().nullable(),
  location_captured_at: z.string().datetime().nullable(),
  location_acquisition_mode: z.enum(["high_accuracy", "balanced_fallback"]).nullable(),
  location_quality: z.enum(["good", "acceptable", "low"]).nullable(),
  selfie_captured_at: z.string().datetime().nullable(),
  selfie_capture_method: z.enum(["live_camera", "file_fallback"]).nullable(),
  selfie_storage_path: z.string().nullable(),
  attendance_id: z.string().uuid().nullable().optional()
}).superRefine((data, ctx) => {
  if (data.visit_outcome === "follow_up") {
    if (!data.follow_up_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Follow-up date is required for this outcome",
        path: ["follow_up_date"]
      });
    } else if (data.follow_up_date < data.visit_date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Follow-up date must not precede visit date",
        path: ["follow_up_date"]
      });
    }
  }
  
  if ((data.visit_outcome === "follow_up" || data.visit_outcome === "not_interested") && !data.visit_notes?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Notes are required for this outcome",
      path: ["visit_notes"]
    });
  }
});

export type CanonicalFieldVisit = z.infer<typeof FieldVisitSchema>;

export function sanitizeRemotePayload(data: unknown): CanonicalFieldVisit {
  return FieldVisitSchema.parse(data);
}
