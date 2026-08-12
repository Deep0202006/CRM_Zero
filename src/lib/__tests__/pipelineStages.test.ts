
// src/lib/__tests__/pipelineStages.test.ts
import { ALLOWED_TRANSITIONS, DISTRIBUTOR_PIPELINE_STAGES, PIPELINE_STAGES, RETAILER_PIPELINE_STAGES, isTransitionAllowed } from "../pipelineStages";

describe("Pipeline transition matrix", () => {
  test("the segment-specific owner-frozen stage names cannot drift", () => {
    expect(PIPELINE_STAGES).toEqual(["New", "Contacted", "Interested", "Not Interested", "Registration", "Installation", "Payment", "Converted", "Renewal Due"]);
    expect(RETAILER_PIPELINE_STAGES).not.toContain("Payment");
    expect(RETAILER_PIPELINE_STAGES).toContain("Converted");
    expect(DISTRIBUTOR_PIPELINE_STAGES).toContain("Payment");
    expect(DISTRIBUTOR_PIPELINE_STAGES).not.toContain("Converted");
  });
  // Generate every possible pair automatically — this is what makes a third
  // hidden bug structurally impossible: the test doesn't rely on someone
  // remembering to add a case, it checks all of them every time.
  const allPairs = PIPELINE_STAGES.flatMap((from) =>
    PIPELINE_STAGES.map((to) => ({ from, to }))
  );

  test.each(allPairs)("agent segment contracts: $from -> $to", ({ from, to }) => {
    for (const segment of ["Retailer", "Distributor"] as const) {
      const shouldBeAllowed = ALLOWED_TRANSITIONS.some((t) => t.from === from && t.to === to && t.allowedBy === "agent" && (!t.segment || t.segment === segment));
      expect(isTransitionAllowed(from, to, "agent", segment)).toBe(shouldBeAllowed);
    }
  });

  test("Payment -> Renewal Due is blocked for agents specifically", () => {
    expect(isTransitionAllowed("Payment", "Renewal Due", "agent", "Distributor")).toBe(false);
    expect(isTransitionAllowed("Payment", "Renewal Due", "system", "Distributor")).toBe(true);
    expect(isTransitionAllowed("Payment", "Renewal Due", "system", "Retailer")).toBe(false);
  });

  test("the canonical matrix is exact", () => {
    expect(ALLOWED_TRANSITIONS).toEqual([
      { from: "New", to: "Contacted", allowedBy: "agent" },
      { from: "Contacted", to: "Interested", allowedBy: "agent" },
      { from: "Contacted", to: "Not Interested", allowedBy: "agent" },
      { from: "Interested", to: "Registration", allowedBy: "agent" },
      { from: "Not Interested", to: "Contacted", allowedBy: "agent" },
      { from: "Registration", to: "Installation", allowedBy: "agent" },
      { from: "Installation", to: "Payment", allowedBy: "agent", segment: "Distributor" },
      { from: "Installation", to: "Converted", allowedBy: "agent", segment: "Retailer" },
      { from: "Payment", to: "Renewal Due", allowedBy: "system", segment: "Distributor" },
      { from: "Renewal Due", to: "Payment", allowedBy: "agent", segment: "Distributor" },
      { from: "Renewal Due", to: "Converted", allowedBy: "agent", segment: "Retailer" },
      { from: "Renewal Due", to: "Not Interested", allowedBy: "agent" },
    ]);
  });

  test("New -> Interested is never a single valid hop for any actor", () => {
    expect(isTransitionAllowed("New", "Interested", "agent", "Retailer")).toBe(false);
    expect(isTransitionAllowed("New", "Interested", "system", "Retailer")).toBe(false);
    // Reaching Interested from New must always go through Contacted as two hops,
    // handled by the call-outcome sequencing logic, not a direct transition.
  });
});
