import { omitPrimaryKeyFromUpdate } from "@/lib/db";

describe("offline update payloads", () => {
  it("omits the primary key but retains completion fields", () => {
    expect(omitPrimaryKeyFromUpdate({ target_id: "target-1", is_completed: true, completed_at: "2026-01-01T00:00:00Z" }, "target_id")).toEqual({ is_completed: true, completed_at: "2026-01-01T00:00:00Z" });
  });
  it("does not add immutable allocated-target fields", () => {
    const payload = omitPrimaryKeyFromUpdate({ target_id: "target-1", is_completed: true, completed_at: "now" }, "target_id");
    expect(payload).not.toHaveProperty("assigned_to_user_id");
    expect(payload).not.toHaveProperty("target_name");
  });
});
