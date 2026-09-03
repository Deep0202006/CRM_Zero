import fs from "node:fs";
import path from "node:path";
import {
  attentionReasons,
  buildSalesHistory,
  canReadLinkedWork,
  classifyTaskFocus,
  completedStageVelocity,
  currentStageAgeRows,
  movementDirection,
  orderedStageCounts,
  pipelineTaskIdFor,
  sanitizePipelineSearch,
  sourceConversionRows,
} from "@/lib/pipeline/salesReview";
import { PIPELINE_STAGES } from "@/lib/pipelineStages";

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

describe("sales operating layer semantics", () => {
  it("keeps every formal stage in canonical order, including zero stages", () => {
    const rows = orderedStageCounts([
      { status: "Converted", lead_count: 2 },
      { status: "New", lead_count: 3 },
      { status: "New", lead_count: 1 },
    ]);
    expect(rows.map((row) => row.stage)).toEqual(PIPELINE_STAGES);
    expect(rows.find((row) => row.stage === "New")?.count).toBe(4);
    expect(rows.find((row) => row.stage === "Payment")?.count).toBe(0);
  });

  it("uses the formal movement matrix instead of array position", () => {
    expect(movementDirection("Installation", "Payment")).toBe("advanced");
    expect(movementDirection("Payment", "Renewal Due")).toBe("cycle");
    expect(movementDirection("Renewal Due", "Payment")).toBe("advanced");
    expect(movementDirection("Contacted", "Not Interested")).toBe("regressed");
    expect(movementDirection("New", "Converted")).toBe("neutral");
  });

  it("weights all-segment current-stage age by represented leads", () => {
    expect(currentStageAgeRows([
      { status: "New", segment_type: "Retailer", avg_days_in_current_stage: 3 },
      { status: "New", segment_type: "Distributor", avg_days_in_current_stage: 9 },
    ], [
      { status: "New", segment_type: "Retailer", lead_count: 1 },
      { status: "New", segment_type: "Distributor", lead_count: 3 },
    ])).toEqual([{ stage: "New", average_days: 7.5, sample_n: 4 }]);
  });

  it("sanitizes server search and emits stable attention reason codes", () => {
    expect(sanitizePipelineSearch("  Acme,(Pune)%  ")).toBe("Acme Pune");
    const reasons = attentionReasons({
      stageAgeDays: 17,
      today: "2026-09-03",
      nextTaskDueDate: "2026-09-01",
      latestTransition: { lead_id: "lead", expected_stage: "Contacted", target_stage: "Not Interested", confirmed_at: "2026-09-03T04:00:00Z" },
    });
    expect(reasons.map((reason) => reason.code)).toEqual(["STALE_STAGE", "OVERDUE_TASK", "CHANGED_TODAY", "REGRESSED"]);
  });

  it("computes completed-stage p50, average, sample, and coverage from real intervals", () => {
    const result = completedStageVelocity([
      { lead_id: "a", expected_stage: "New", target_stage: "Contacted", confirmed_at: "2026-09-02T00:00:00Z" },
      { lead_id: "b", expected_stage: "New", target_stage: "Contacted", confirmed_at: "2026-09-05T00:00:00Z" },
    ], new Map([["a", "2026-09-01T00:00:00Z"], ["b", "2026-09-01T00:00:00Z"]]));
    expect(result.rows).toContainEqual({ stage: "New", p50_days: 2.5, average_days: 2.5, sample_n: 2 });
    expect(result).toMatchObject({ sample_n: 2, coverage_n: 2, coverage_pct: 100 });
  });

  it("returns exactly 12 real periods with explicit zeroes and direction counts", () => {
    const history = buildSalesHistory(
      [{ lead_id: "a", created_at: "2026-09-03T04:00:00Z" }],
      [{ lead_id: "a", expected_stage: "Installation", target_stage: "Payment", confirmed_at: "2026-09-03T06:00:00Z" }],
      "2026-09-03",
      "weeks",
    );
    expect(history).toHaveLength(12);
    expect(history.slice(0, -1).every((point) => point.new_leads === 0 && point.movements === 0)).toBe(true);
    expect(history.at(-1)).toMatchObject({ new_leads: 1, successes: 1, movements: 1, advanced: 1, regressed: 0 });
  });

  it("reconciles source denominators and classifies exact follow-up urgency", () => {
    expect(sourceConversionRows([
      { lead_source: "Referral", total_leads: 3, converted: 1 },
      { lead_source: "Referral", total_leads: 2, converted: 1 },
    ])).toEqual([{ source: "Referral", total: 5, converted: 2, rate: 40, reconciled: true }]);
    expect(classifyTaskFocus({ status: "Pending", due_date: "2026-09-03" }, "2026-09-03", true).reason_code).toBe("FOLLOWUP_DUE_TODAY");
    expect(classifyTaskFocus({ status: "Pending", due_date: "2026-09-03" }, "2026-09-03", false).priority).toBe("P1");
  });

  it("keeps linked Task and Call context private to their employee unless Admin", () => {
    expect(canReadLinkedWork(false, "employee-a", "employee-a")).toBe(true);
    expect(canReadLinkedWork(false, "employee-a", "employee-b")).toBe(false);
    expect(canReadLinkedWork(true, "admin", "employee-b")).toBe(true);
  });

  it("derives one deterministic RFC UUID for same-day Pipeline task retries", async () => {
    const first = await pipelineTaskIdFor("user-a", "lead-a", "2026-09-03");
    const retry = await pipelineTaskIdFor("user-a", "lead-a", "2026-09-03");
    const nextDay = await pipelineTaskIdFor("user-a", "lead-a", "2026-09-04");
    expect(first).toBe(retry);
    expect(first).not.toBe(nextDay);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("sales operating layer integration guards", () => {
  it("carries an exact Pipeline UUID into the existing Call client-reference contract", () => {
    const pipeline = read("src/app/onboarding/page.tsx");
    const calls = read("src/app/call-logs/page.tsx");
    expect(pipeline).toContain("lead_id=${encodeURIComponent(selectedLead.lead_id)}");
    expect(calls).toContain("parseCallClientReference(leadId).leadId");
  });

  it("queues an explicit exact-lead task with stable local and outbox identity", () => {
    const action = read("src/lib/pipeline/taskAction.ts");
    const database = read("src/lib/db.ts");
    expect(action).toContain("related_lead_id: input.leadId");
    expect(action).toContain("pipeline-task:${taskId}");
    expect(database).toContain("queueTaskInsertOnce");
    expect(database).toContain('where("idempotency_key").equals(idempotencyKey)');
    expect(database).toContain("if (local) return false");
  });

  it("keeps manager filters and lead context bounded and server-authoritative", () => {
    const context = read("src/app/api/pipeline/leads/[leadId]/context/route.ts");
    const inspection = read("src/app/api/pipeline/inspection/route.ts");
    const manager = read("src/app/manager/kpi/FunnelTab.tsx");
    expect(context).toContain(".limit(20)");
    expect(context).toContain(".limit(10)");
    expect(inspection).toContain(".limit(50)");
    expect(inspection).toContain("sanitizePipelineSearch");
    expect(manager).toContain("/api/pipeline/inspection");
    expect(manager).not.toMatch(/\.from\(["'](?:pipeline_funnel_summary|lead_source_performance|avg_time_in_stage)/);
    expect([context, inspection, manager].join("\n")).not.toContain("setInterval");
  });
});
