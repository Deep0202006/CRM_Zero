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

  it("repairs an arbitrary legacy call reference with the original ID and identity", () => {
    const result = prepareSyncPayload("call_logs", {
      log_id: "00000000-0000-4000-8000-000000000099",
      lead_id: "New Horizon Party",
      outcome: "Happy call",
    });

    expect(result).toMatchObject({
      changed: true,
      data: {
        log_id: "00000000-0000-4000-8000-000000000099",
        lead_id: null,
        client_username: null,
        client_name: "New Horizon Party",
      },
    });
  });

  it("does not overwrite a better identity while repairing a non-UUID lead value", () => {
    expect(prepareSyncPayload("call_logs", {
      log_id: "00000000-0000-4000-8000-000000000098",
      lead_id: "legacy free text",
      client_username: "canonical-user",
      client_name: "Canonical Party",
    }).data).toMatchObject({
      lead_id: null,
      client_username: "canonical-user",
      client_name: "Canonical Party",
    });
  });

  it("treats blank legacy identity fields as missing", () => {
    expect(prepareSyncPayload("call_logs", {
      log_id: "00000000-0000-4000-8000-000000000097",
      lead_id: "Preserved Party",
      client_username: "   ",
      client_name: "",
    }).data).toMatchObject({
      lead_id: null,
      client_username: null,
      client_name: "Preserved Party",
    });
  });

  it("leaves valid payloads unchanged", () => {
    expect(prepareSyncPayload("call_logs", {
      log_id: "00000000-0000-4000-8000-000000000010",
      lead_id: "00000000-0000-4000-8000-000000000001",
    }).changed).toBe(false);
  });
});
