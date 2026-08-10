
// src/lib/__tests__/pipelineStages.test.ts
import { ALLOWED_TRANSITIONS, PIPELINE_STAGES, isTransitionAllowed } from "../pipelineStages";

describe("Pipeline transition matrix", () => {
  test("the eight owner-frozen stage names and order cannot drift", () => {
    expect(PIPELINE_STAGES).toEqual(["New", "Contacted", "Interested", "Not Interested", "Registration", "Installation", "Payment", "Renewal Due"]);
  });
  // Generate every possible pair automatically — this is what makes a third
  // hidden bug structurally impossible: the test doesn't rely on someone
  // remembering to add a case, it checks all of them every time.
  const allPairs = PIPELINE_STAGES.flatMap((from) =>
    PIPELINE_STAGES.map((to) => ({ from, to }))
  );

  test.each(allPairs)("agent: $from -> $to", ({ from, to }) => {
    const shouldBeAllowed = ALLOWED_TRANSITIONS.some((t) => t.from === from && t.to === to && t.allowedBy === "agent");
    expect(isTransitionAllowed(from, to, "agent")).toBe(shouldBeAllowed);
  });

  test("Payment -> Renewal Due is blocked for agents specifically", () => {
    expect(isTransitionAllowed("Payment", "Renewal Due", "agent")).toBe(false);
    expect(isTransitionAllowed("Payment", "Renewal Due", "system")).toBe(true);
  });

  test("the canonical matrix is exact", () => {
    expect(ALLOWED_TRANSITIONS).toEqual([
      { from: "New", to: "Contacted", allowedBy: "agent" },
      { from: "Contacted", to: "Interested", allowedBy: "agent" },
      { from: "Contacted", to: "Not Interested", allowedBy: "agent" },
      { from: "Interested", to: "Registration", allowedBy: "agent" },
      { from: "Not Interested", to: "Contacted", allowedBy: "agent" },
      { from: "Registration", to: "Installation", allowedBy: "agent" },
      { from: "Installation", to: "Payment", allowedBy: "agent" },
      { from: "Payment", to: "Renewal Due", allowedBy: "system" },
      { from: "Renewal Due", to: "Payment", allowedBy: "agent" },
      { from: "Renewal Due", to: "Not Interested", allowedBy: "agent" },
    ]);
  });

  test("New -> Interested is never a single valid hop for any actor", () => {
    expect(isTransitionAllowed("New", "Interested", "agent")).toBe(false);
    expect(isTransitionAllowed("New", "Interested", "system")).toBe(false);
    // Reaching Interested from New must always go through Contacted as two hops,
    // handled by the call-outcome sequencing logic, not a direct transition.
  });
});
