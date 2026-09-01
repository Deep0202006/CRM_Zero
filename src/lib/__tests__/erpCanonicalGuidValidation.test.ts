import { stableErpId } from "@/lib/erp/domain";

jest.mock("server-only", () => ({}), { virtual: true });

import { canonicalErpIdSchema } from "@/lib/erp/validation";
import { distributorListSchema, renewalReadSchema } from "@/lib/distributors/validation";
import { receivablesFilterSchema } from "@/lib/receivables/validation";
import { VisitConfirmationSchema } from "@/app/api/field-visits/confirm/route";
import { CreateUserSchema } from "@/app/api/admin/create-user/route";
import { UpdateSchema } from "@/app/api/admin/erp-partners/route";
import { erpIdSchema } from "@/app/api/admin/visits/erp-baselines/route";
import { querySchema as partnerDistributorQuerySchema } from "@/app/api/erp-partner/distributors/route";
import { querySchema as partnerRenewalQuerySchema } from "@/app/api/erp-partner/renewals/route";

const canonicalErpId = stableErpId("MARG");

describe("canonical PostgreSQL ERP GUID validation", () => {
  it("accepts deterministic ERP IDs and rejects malformed IDs", () => {
    expect(canonicalErpIdSchema.safeParse(canonicalErpId).success).toBe(true);
    for (const value of ["marg", "123", "not-a-guid", "12345678-1234-1234-1234-12345678901"])
      expect(canonicalErpIdSchema.safeParse(value).success).toBe(false);
  });

  it("preserves canonical ERP filters while rejecting malformed filters", () => {
    expect(distributorListSchema.parse({ erp: canonicalErpId }).erp).toBe(canonicalErpId);
    expect(renewalReadSchema.parse({ erp: canonicalErpId }).erp).toBe(canonicalErpId);
    expect(receivablesFilterSchema.parse({ erp: canonicalErpId }).erp).toBe(canonicalErpId);
    expect(distributorListSchema.safeParse({ erp: "not-a-guid" }).success).toBe(false);
  });

  it("accepts canonical ERP IDs at every ERP HTTP boundary", () => {
    expect(VisitConfirmationSchema.shape.erp_id.safeParse(canonicalErpId).success).toBe(true);
    expect(CreateUserSchema.safeParse({ account_type: "erp_partner", email: "partner", name: "Partner", capabilities: ["erp_partner_viewer"], erp_scope_ids: [canonicalErpId] }).success).toBe(true);
    expect(UpdateSchema.safeParse({ user_id: "00000000-0000-4000-8000-000000000001", erp_scope_ids: [canonicalErpId] }).success).toBe(true);
    expect(erpIdSchema.safeParse(canonicalErpId).success).toBe(true);
    expect(partnerDistributorQuerySchema.safeParse({ erp: canonicalErpId }).success).toBe(true);
    expect(partnerRenewalQuerySchema.safeParse({ erp: canonicalErpId }).success).toBe(true);
  });

  it("accepts only the exact ERP Partner status-card filters", () => {
    expect(partnerDistributorQuerySchema.safeParse({ installation: "done", training: "pending", billing: "billed", activity: "active", erpPayment: "paid", renewal: "overdue" }).success).toBe(true);
    for (const value of [
      { installation: "complete" }, { training: "done" }, { billing: "paid" },
      { activity: "inactive" }, { erpPayment: "financially_paid" }, { renewal: "tomorrow" },
    ]) expect(partnerDistributorQuerySchema.safeParse(value).success).toBe(false);
  });
});
