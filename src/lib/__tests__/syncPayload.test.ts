import { prepareSyncPayload } from "../syncPayload";

describe("offline sync payload repair", () => {
  it("repairs a dead-letter-prone legacy call reference without losing client identity", () => {
    const result = prepareSyncPayload("call_logs", {
      log_id: "00000000-0000-4000-8000-000000000010",
      lead_id: "EXCEL::retailer01::Retailer One",
      outcome: "Happy call",
    });

    expect(result.changed).toBe(true);
    expect(result.data).toMatchObject({
      lead_id: null,
      client_username: "retailer01",
      client_name: "Retailer One",
    });
  });

  it("removes an invalid Excel reference from a task foreign key", () => {
    const result = prepareSyncPayload("tasks", {
      task_id: "00000000-0000-4000-8000-000000000020",
      related_lead_id: "EXCEL::retailer01::Retailer One",
    });
    expect(result).toMatchObject({
      changed: true,
      data: { related_lead_id: null },
    });
  });

  it("leaves valid payloads unchanged", () => {
    expect(prepareSyncPayload("call_logs", {
      log_id: "00000000-0000-4000-8000-000000000010",
      lead_id: "00000000-0000-4000-8000-000000000001",
    }).changed).toBe(false);
  });
});
