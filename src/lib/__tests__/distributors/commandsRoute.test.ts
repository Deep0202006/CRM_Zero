jest.mock("server-only", () => ({}), { virtual: true });

const contextForMock = jest.fn();
const rpcMock = jest.fn();

jest.mock("@/lib/distributors/server", () => ({
  contextFor: (...args: unknown[]) => contextForMock(...args),
  apiError: (status: number, code: string, message: string, current?: unknown) => Response.json({ code, message, ...(current === undefined ? {} : { current }) }, { status }),
  distributorReadError: () => Response.json({ code: "DISTRIBUTOR_SERVER_ERROR", message: "failed" }, { status: 503 }),
  externalViewerDenied: () => null,
  requestHash: () => "request-hash",
  stableDistributorId: () => "40000000-0000-4000-a000-000000000001",
}));

import { POST } from "@/app/api/distributors/commands/route";

const operationId = "30000000-0000-4000-a000-000000000001";
const distributorId = "40000000-0000-4000-a000-000000000001";
const renew = { operation_id: operationId, operation_type: "renew", payload: { distributor_id: distributorId, expected_version: 2, renewal_date: "2026-09-01", note: "" } };

function request(body: unknown) {
  return new Request("http://localhost/api/distributors/commands", { method: "POST", body: JSON.stringify(body) });
}

function context(isAdmin: boolean, result: Record<string, unknown>) {
  rpcMock.mockResolvedValue({ data: result, error: null });
  return { isAdmin, userId: isAdmin ? "10000000-0000-4000-a000-000000000001" : "20000000-0000-4000-a000-000000000001", service: { rpc: rpcMock } };
}

describe("Distributor command route role boundary", () => {
  beforeEach(() => { contextForMock.mockReset(); rpcMock.mockReset(); });

  test("requires an authenticated active profile", async () => {
    contextForMock.mockResolvedValue(null);
    expect((await POST(request(renew))).status).toBe(401);
  });

  test.each(["create", "update"])("rejects employee %s before the database command", async (operation_type) => {
    contextForMock.mockResolvedValue(context(false, { success: true }));
    const response = await POST(request({ ...renew, operation_type }));
    expect(response.status).toBe(403); expect(rpcMock).not.toHaveBeenCalled();
  });

  test("allows employee renewal and maps an unassigned denial without leaking a row", async () => {
    contextForMock.mockResolvedValue(context(false, { success: false, code: "DISTRIBUTOR_NOT_ASSIGNED" }));
    const response = await POST(request(renew)); const body = await response.json();
    expect(response.status).toBe(403); expect(body).not.toHaveProperty("current"); expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  test("allows Admin renewal", async () => {
    contextForMock.mockResolvedValue(context(true, { success: true, record: { distributor_id: distributorId, version: 3 } }));
    const response = await POST(request(renew));
    expect(response.status).toBe(200); expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  test("rejects impossible renewal dates before the RPC", async () => {
    contextForMock.mockResolvedValue(context(true, { success: true }));
    const response = await POST(request({ ...renew, payload: { ...renew.payload, renewal_date: "2026-02-31" } }));
    expect(response.status).toBe(400); expect(rpcMock).not.toHaveBeenCalled();
  });
});
