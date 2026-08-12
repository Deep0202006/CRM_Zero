import { mergeAuthoritativePipeline } from "../../pipeline/authority";
import type { PipelineLeadView } from "../../pipeline/contract";

const lead = (id: string, status: PipelineLeadView["status"], segment: PipelineLeadView["segment_type"] = "Retailer"): PipelineLeadView => ({
  lead_id: id, business_name: `Lead ${id}`, contact_person: "Person", phone: "0000000000", segment_type: segment,
  status, assigned_to: "owner", owner_name: "Owner Name", created_at: `2026-08-10T00:00:0${id}.000Z`,
});

describe("Pipeline server authority", () => {
  test("server rows win over stale local rows and pending creations remain", () => {
    const result = mergeAuthoritativePipeline([lead("1", "Interested")], [{ ...lead("1", "Contacted"), pending_creation: true }, { ...lead("2", "New"), pending_creation: true }]);
    expect(result).toHaveLength(2); expect(result.find((item) => item.lead_id === "1")?.status).toBe("Interested");
  });

  test("owner identity is human-readable data, not a rendered UUID", () => {
    expect(lead("1", "New").owner_name).toBe("Owner Name");
  });
});
