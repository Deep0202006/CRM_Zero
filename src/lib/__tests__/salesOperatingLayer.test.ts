import fs from "node:fs";
import path from "node:path";

const read = (relativePath: string) => fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");

describe("sales operating layer", () => {
  it("carries an exact pipeline UUID into the existing Call client-reference contract", () => {
    const pipeline = read("src/app/onboarding/page.tsx");
    const calls = read("src/app/call-logs/page.tsx");
    expect(pipeline).toContain("lead_id=${encodeURIComponent(selectedLead.lead_id)}");
    expect(calls).toContain("parseCallClientReference(leadId).leadId");
    expect(calls).toContain("setSelectedLeadId(leadId)");
  });

  it("creates only an explicit stable-ID task linked to the exact lead", () => {
    const pipeline = read("src/app/onboarding/page.tsx");
    expect(pipeline).toContain('transactionalMutation("tasks", "INSERT"');
    expect(pipeline).toContain("task_id: crypto.randomUUID()");
    expect(pipeline).toContain("related_lead_id: lead.lead_id");
    expect(pipeline).toContain("An active exact Lead task already exists.");
  });

  it("keeps context bounded and manager inspection server-authoritative", () => {
    const context = read("src/app/api/pipeline/leads/[leadId]/context/route.ts");
    const inspection = read("src/app/api/pipeline/inspection/route.ts");
    const manager = read("src/app/manager/kpi/FunnelTab.tsx");
    expect(context).toContain(".limit(20)");
    expect(context).toContain(".limit(10)");
    expect(inspection).toContain(".limit(50)");
    expect(inspection).toContain('capability_code === "admin"');
    expect(manager).toContain("/api/pipeline/inspection");
    expect(manager).not.toMatch(/\.from\(["'](?:pipeline_funnel_summary|lead_source_performance|avg_time_in_stage)/);
    expect([context, inspection, manager].join("\n")).not.toContain("setInterval");
  });

  it("derives a reasoned P0/P1/P2 queue without a score or persistence", () => {
    const myDay = read("src/app/my-day/page.tsx");
    expect(myDay).toContain('"P0"');
    expect(myDay).toContain('"P1"');
    expect(myDay).toContain('"P2"');
    expect(myDay).toContain("Overdue next action");
    expect(myDay).not.toContain("focus_score");
  });
});
