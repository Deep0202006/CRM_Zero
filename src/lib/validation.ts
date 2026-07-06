import { z } from "zod";

// Pipeline stage constants
export const PIPELINE_STAGES = [
  "New",
  "Contacted",
  "Interested",
  "Not Interested",
  "Registration",
  "Installation",
  "Payment",
  "Renewal Due"
] as const;

export type LeadStatus = typeof PIPELINE_STAGES[number];

// Segment type constants
export const SEGMENT_TYPES = ["Distributor", "Retailer"] as const;
export type LeadSegment = typeof SEGMENT_TYPES[number];

// Define allowed linear transitions
// Sequence: New -> Contacted -> Interested (or Not Interested) -> Registration -> Payment -> Installation
export const ALLOWED_TRANSITIONS: Record<LeadStatus, LeadStatus[]> = {
  "New": ["Contacted"],
  "Contacted": ["Interested", "Not Interested"],
  "Interested": ["Registration"],
  "Not Interested": ["Contacted"], // can re-contact a lost lead
  "Registration": ["Installation"],
  "Installation": ["Payment"],
  "Payment": [], // final stage (agent cannot trigger Renewal Due manually)
  "Renewal Due": ["Payment", "Not Interested"]
};

/**
 * Validates if a transition from currentStatus to nextStatus is allowed in the linear pipeline
 */
export function validateLeadStatusTransition(currentStatus: LeadStatus, nextStatus: LeadStatus): boolean {
  if (currentStatus === nextStatus) return true;
  const allowed = ALLOWED_TRANSITIONS[currentStatus];
  if (!allowed) return false;
  return allowed.includes(nextStatus);
}

// UUID validation helper
const uuidSchema = z.string().uuid("Invalid UUID format");

// 1. User Validation Schema
export const userSchema = z.object({
  user_id: uuidSchema.optional(),
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email address"),
  is_active: z.boolean().default(true),
  created_at: z.string().optional()
});

// 2. Lead Validation Schema
export const leadSchema = z.object({
  lead_id: uuidSchema.optional(),
  business_name: z.string().min(2, "Business name must be at least 2 characters"),
  contact_person: z.string().min(2, "Contact person must be at least 2 characters"),
  phone: z.string().min(10, "Phone number must be at least 10 digits"),
  segment_type: z.enum(SEGMENT_TYPES),
  status: z.enum(PIPELINE_STAGES).default("New"),
  loss_reason: z.string().optional().nullable(),
  assigned_to: uuidSchema.optional().nullable(),
  created_at: z.string().optional(),
  onboarded_at: z.string().optional().nullable()
});

// 3. Client Query Validation Schema (Simplified to Client Problem & Problem Status)
export const clientQuerySchema = z.object({
  query_id: uuidSchema.optional(),
  lead_id: uuidSchema,
  client_problem: z.string().min(5, "Problem description must be at least 5 characters"),
  problem_status: z.enum(["Open", "In Progress", "Resolved"]).default("Open"),
  assigned_to: uuidSchema.optional().nullable(),
  created_at: z.string().optional(),
  resolved_at: z.string().optional().nullable()
});

// 4. Mappings Validation Schema
export const mappingSchema = z.object({
  mapping_id: uuidSchema.optional(),
  distributor_lead_id: uuidSchema,
  retailer_lead_id: uuidSchema,
  requested_by: z.string().min(2, "Requested by must be at least 2 characters"),
  mapped_by: uuidSchema.optional().nullable(),
  notes: z.string().optional().nullable(),
  created_at: z.string().optional(),
  request_source: z.string().default("Web"),
  completion_timestamp: z.string().optional()
});

// 5. Mapping Request Validation Schema
export const mappingRequestSchema = z.object({
  request_id: uuidSchema.optional(),
  distributor_lead_id: uuidSchema,
  retailer_lead_id: uuidSchema,
  mapped_by: uuidSchema.optional().nullable(),
  status: z.enum(["Pending", "Completed"]).default("Pending"),
  notes: z.string().optional().nullable(),
  created_at: z.string().optional(),
  completed_at: z.string().optional().nullable()
});

// 6. Internal Ticket Validation Schema
export const internalTicketSchema = z.object({
  ticket_id: uuidSchema.optional(),
  raised_by: uuidSchema,
  category: z.enum(["Access", "Bug", "Data", "Other"]).default("Other"),
  priority: z.enum(["Low", "Medium", "High"]).default("Low"),
  status: z.enum(["Open", "In Progress", "Resolved"]).default("Open"),
  description: z.string().min(5, "Description must be at least 5 characters"),
  assigned_to: uuidSchema.optional().nullable(),
  created_at: z.string().optional(),
  resolved_at: z.string().optional().nullable()
});

// 7. Attendance Validation Schema
export const attendanceSchema = z.object({
  attendance_id: uuidSchema.optional(),
  user_id: uuidSchema,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  clock_in: z.string().optional(),
  clock_out: z.string().optional().nullable(),
  selfie_url: z.string().url("Invalid selfie image URL"),
  latitude: z.number().min(-90).max(90, "Latitude must be between -90 and 90"),
  longitude: z.number().min(-180).max(180, "Longitude must be between -180 and 180")
});

// 8. Call Log Validation Schema
export const callLogSchema = z.object({
  log_id: uuidSchema.optional(),
  user_id: uuidSchema,
  lead_id: uuidSchema,
  timestamp: z.string().optional(),
  outcome: z.string().min(2, "Outcome must be at least 2 characters"),
  notes: z.string().optional().nullable(),
  next_followup_date: z.string().optional().nullable()
});
