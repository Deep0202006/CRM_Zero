import { isProvenPipelineGeneratedTask } from "../../taskEngine";

const base = { assigned_by: null, source: "manual" as const, related_lead_id: "lead", title: "", description: "" };
describe("Pipeline task provenance", () => {
  test("recognizes only the two deployed Pipeline generators", () => {
    expect(isProvenPipelineGeneratedTask({ ...base, title: "Follow up: Shop (Payment)", description: "Lead moved to Payment. Follow up before it goes stale." })).toBe(true);
    expect(isProvenPipelineGeneratedTask({ ...base, title: "Collect GST certificate: Shop", description: "Required for registration." })).toBe(true);
  });
  test("preserves manual, Call, Field Visit, and ambiguous lead work", () => {
    expect(isProvenPipelineGeneratedTask({ ...base, title: "Call customer", description: "Manual reminder" })).toBe(false);
    expect(isProvenPipelineGeneratedTask({ ...base, assigned_by: "employee", title: "Follow up: Shop (Payment)", description: "Lead moved to Payment. Follow up before it goes stale." })).toBe(false);
    expect(isProvenPipelineGeneratedTask({ ...base, source: "template", title: "Follow up: Shop (Payment)", description: "Lead moved to Payment. Follow up before it goes stale." })).toBe(false);
    expect(isProvenPipelineGeneratedTask({ ...base, related_lead_id: null, title: "Follow up: Shop (Payment)", description: "Lead moved to Payment. Follow up before it goes stale." })).toBe(false);
  });
});
