// src/lib/__tests__/pipelineRules.test.ts
import { ALLOWED_TRANSITIONS, PIPELINE_STAGES, isTransitionAllowed } from "../pipelineRules";

describe("Pipeline transition matrix", () => {
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

  test("New -> Interested is never a single valid hop for any actor", () => {
    expect(isTransitionAllowed("New", "Interested", "agent")).toBe(false);
    expect(isTransitionAllowed("New", "Interested", "system")).toBe(false);
    // Reaching Interested from New must always go through Contacted as two hops,
    // handled by the call-outcome sequencing logic, not a direct transition.
  });
});
