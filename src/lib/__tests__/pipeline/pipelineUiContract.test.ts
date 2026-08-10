import fs from "node:fs";
import path from "node:path";

describe("Pipeline UI contract", () => {
  const page = fs.readFileSync(path.join(process.cwd(), "src/app/onboarding/page.tsx"), "utf8");
  test("all frozen stages are rendered from the canonical list", () => { expect(page).toContain("PIPELINE_STAGES.map"); });
  test("only assigned users receive exact transition actions", () => { expect(page).toContain("lead.assigned_to === currentUser?.user_id"); expect(page).toContain("Move to ${action.to}"); });
  test("owner names render without UUID decoration", () => { expect(page).toContain("Owner: {lead.owner_name}"); expect(page).not.toContain("(@${"); });
  test("dead gates and synthetic calls are absent", () => { expect(page).not.toContain("STAGE_GATES"); expect(page).not.toContain('transactionalMutation("call_logs"'); });
});
