import { addISTDateDays } from "@/lib/dateTime";
import { renewalState, validateStatusCombination } from "@/lib/distributors/domain";
import { distributorListSchema, distributorRenewSchema } from "@/lib/distributors/validation";

describe("Distributor Status domain", () => {
  test.each([["2026-08-16", "renewal_upcoming"], ["2026-08-15", "renewal_due_in_2_days"], ["2026-08-14", "renewal_due_tomorrow"], ["2026-08-13", "renewal_due_today"], ["2026-08-12", "renewal_overdue"], [null, "none"]])("derives IST renewal state for %s", (date, state) => expect(renewalState(date, "2026-08-13")).toBe(state));
  test("adds IST calendar days across month/year boundaries", () => { expect(addISTDateDays("2026-12-31", 1)).toBe("2027-01-01"); expect(addISTDateDays("2026-02-28", 1)).toBe("2026-03-01"); });
  test("preserves lifecycle projections and independent overlapping facts", () => {
    expect(validateStatusCombination({ installation_status: "pending", training_status: "done", mapping_status: "pending", activity_status: "not_applicable" })).toMatch(/Training/);
    expect(validateStatusCombination({ installation_status: "done", training_status: "pending", mapping_status: "done", activity_status: "not_applicable" })).toMatch(/Mapping/);
    expect(validateStatusCombination({ installation_status: "done", training_status: "done", mapping_status: "pending", mapped_at: "2026-08-13", activity_status: "active" })).toMatch(/Mapped Date/);
    expect(validateStatusCombination({ installation_status: "done", training_status: "done", mapping_status: null, activity_status: "active" })).toBeNull();
    expect(validateStatusCombination({ installation_status: "done", training_status: "done", mapping_status: "done", mapped_at: "2026-08-13", activity_status: "inactive" })).toBeNull();
  });
  test("list filters reject unknown statuses and malformed employee IDs", () => {
    expect(distributorListSchema.safeParse({ activity: "made_up" }).success).toBe(false);
    expect(distributorListSchema.safeParse({ assignedTo: "employee-name" }).success).toBe(false);
    expect(distributorListSchema.safeParse({ mapping: "done", pageSize: "50" }).success).toBe(true);
  });
  test("command dates reject impossible calendar days before PostgreSQL", () => {
    expect(distributorRenewSchema.safeParse({ distributor_id: "40000000-0000-4000-a000-000000000001", expected_version: 1, renewal_date: "2026-02-31", note: "" }).success).toBe(false);
  });
});
