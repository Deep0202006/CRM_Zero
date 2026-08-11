const rpc = jest.fn();
const context = {
  userId: "20000000-0000-4000-a000-000000000001",
  isAdmin: false,
  service: { rpc },
  userClient: {},
};

jest.mock("@/lib/receivables/server", () => ({
  isReceivablesReady: () => true,
  contextFor: jest.fn(async () => context),
  requestHash: () => "a".repeat(64),
  commandMessages: {},
  apiError: (status: number, code: string, message: string, current?: unknown) => Response.json({ success: false, code, message, ...(current ? { current } : {}) }, { status }),
}));
jest.mock("@/lib/receivables/importServer", () => ({ buildImportPreview: jest.fn() }));

import { POST as command } from "@/app/api/receivables/commands/route";
import { POST as importSpreadsheet } from "@/app/api/receivables/import/route";

const operationId = "10000000-0000-4000-a000-000000000010";
const receivableId = "20000000-0000-4000-a000-000000000010";
const assigneeId = "30000000-0000-4000-a000-000000000010";

describe("Receivables API authorization runtime", () => {
  beforeEach(() => rpc.mockReset());

  test("passes only the authenticated actor to the database despite forged identity claims", async () => {
    rpc.mockResolvedValue({ data: { success: false, code: "ADMIN_REQUIRED" }, error: null });
    const response = await command(new Request("http://local/api/receivables/commands", { method: "POST", body: JSON.stringify({
      operation_id: operationId,
      operation_type: "reassign",
      payload: { receivable_id: receivableId, expected_version: 1, assigned_to: assigneeId },
      actor_id: "10000000-0000-4000-a000-000000000001",
      user_id: "10000000-0000-4000-a000-000000000001",
      isAdmin: true,
      role: "admin",
    }) }));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("INVALID_COMMAND");
    expect(rpc).not.toHaveBeenCalled();

    const validResponse = await command(new Request("http://local/api/receivables/commands", { method: "POST", body: JSON.stringify({ operation_id: operationId, operation_type: "reassign", payload: { receivable_id: receivableId, expected_version: 1, assigned_to: assigneeId } }) }));
    expect(validResponse.status).toBe(403);
    expect(rpc).toHaveBeenCalledWith("execute_receivable_command_v1", expect.objectContaining({ p_actor_id: context.userId }));
  });

  test("employee cannot even preview or confirm an import", async () => {
    for (const mode of ["preview", "confirm"]) {
      const response = await importSpreadsheet(new Request("http://local/api/receivables/import", { method: "POST", body: JSON.stringify({ mode, operation_id: operationId, filename: "receivables.csv", ...(mode === "confirm" ? { preview_hash: "a".repeat(64) } : {}), rows: [] }) }));
      expect(response.status).toBe(403);
      expect((await response.json()).code).toBe("ADMIN_REQUIRED");
    }
  });
});
