import fs from "node:fs";
import path from "node:path";

describe("Pipeline UI contract", () => {
  const page = fs.readFileSync(path.join(process.cwd(), "src/app/onboarding/page.tsx"), "utf8");
  test("segment-specific stages are rendered from the canonical list", () => { expect(page).toContain("stagesForSegment(segmentTab).map"); });
  test("only assigned users receive exact transition actions", () => { expect(page).toContain("lead.assigned_to === currentUser?.user_id"); expect(page).toContain("Move to ${action.to}"); });
  test("owner names render without UUID decoration", () => { expect(page).toContain("Owner: {lead.owner_name}"); expect(page).not.toContain("(@${"); });
  test("dead gates and synthetic calls are absent", () => { expect(page).not.toContain("STAGE_GATES"); expect(page).not.toContain('transactionalMutation("call_logs"'); });
  test("the board owns visible native horizontal overflow in a viewport-bounded shell", () => {
    expect(page).toContain("pipeline-board-shell"); expect(page).toContain("overflow-x-scroll"); expect(page).toContain("overflow-y-hidden");
    expect(page).toContain("100dvh - 19rem"); expect(page).toContain('scrollbarGutter: "stable both-edges"'); expect(page).not.toContain("scrollbar-hide");
  });
  test("readable columns and their lead lists own separate axes", () => {
    expect(page).toContain("pipeline-board-track"); expect(page).toContain("min-w-max"); expect(page).toContain("w-[292px]"); expect(page).toContain("flex-none");
    expect(page).toContain("pipeline-stage-leads"); expect(page).toContain("overflow-y-auto"); expect(page).toContain("overflow-x-hidden");
  });
  test("the scroller is keyboard and touch usable without global overflow changes", () => {
    expect(page).toContain("tabIndex={0}"); expect(page).toContain("overscroll-x-contain"); expect(page).not.toContain("document.body.style.overflow");
  });
  test("cards contain long content and segment columns remain canonical", () => {
    expect(page).toContain("min-w-0 overflow-hidden"); expect(page).toContain("stagesForSegment(segmentTab).map");
  });
});
