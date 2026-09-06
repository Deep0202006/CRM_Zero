import { z } from "zod";
import { canonicalErpIdSchema } from "@/lib/erp/validation";

const VALID_CAPABILITIES = [
  "admin",
  "task_assigner",
  "dist_onboarding",
  "dist_support",
  "ret_onboarding",
  "ret_support",
  "field_dist",
  "field_ret",
  "tech_support",
  "erp_partner_viewer",
] as const;

export const CreateUserSchema = z
  .object({
    account_type: z.enum(["internal", "erp_partner"]),
    email: z.string().min(3, "Email/Username is required"),
    name: z.string().min(2, "Name is required"),
    phone: z.string().max(20, "Phone number is too long").optional().nullable(),
    password: z
      .string()
      .min(6, "Password must be at least 6 characters")
      .optional(),
    capabilities: z
      .array(z.enum(VALID_CAPABILITIES))
      .min(1, "Select at least one role"),
    erp_scope_ids: z.array(canonicalErpIdSchema).max(100).default([]),
    manager_id: z.string().uuid().nullable().optional(),
  })
  .superRefine((value, context) => {
    const isPartner = value.account_type === "erp_partner";
    if (
      isPartner &&
      (value.capabilities.length !== 1 ||
        value.capabilities[0] !== "erp_partner_viewer")
    ) {
      context.addIssue({
        code: "custom",
        path: ["capabilities"],
        message: "ERP Partner Viewer is an exclusive account type",
      });
    }
    if (isPartner && value.erp_scope_ids.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["erp_scope_ids"],
        message: "Select at least one ERP scope",
      });
    }
    if (!isPartner && value.capabilities.includes("erp_partner_viewer")) {
      context.addIssue({
        code: "custom",
        path: ["capabilities"],
        message: "ERP Partner Viewer cannot be mixed with internal capabilities",
      });
    }
    if (isPartner && value.manager_id) {
      context.addIssue({
        code: "custom",
        path: ["manager_id"],
        message: "External accounts do not have managers",
      });
    }
  });
