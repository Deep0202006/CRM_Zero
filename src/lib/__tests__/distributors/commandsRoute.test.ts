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
const erpPayment = { operation_id: operationId, operation_type: "erp_payment", payload: { distributor_id: distributorId, expected_version: 2, erp_payment_status: "paid", note: "" } };

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

  test.each(["create", "update", "erp_payment"])("rejects employee %s before the database command", async (operation_type) => {
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

  test("routes only validated Admin ERP payment commands to the exact RPC", async () => {
    contextForMock.mockResolvedValue(context(true, { success: true, record: { distributor_id: distributorId, version: 3 } }));
    const response = await POST(request(erpPayment));
    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("distributor_erp_payment_status_command_v1", expect.objectContaining({
      p_operation_id: operationId,
      p_operation_type: "erp_payment",
      p_payload: erpPayment.payload,
    }));
  });

  test("rejects an unknown ERP payment status before the RPC", async () => {
    contextForMock.mockResolvedValue(context(true, { success: true }));
    const response = await POST(request({ ...erpPayment, payload: { ...erpPayment.payload, erp_payment_status: "received" } }));
    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  test.each([
    ["ERP_PAYMENT_STATUS_REQUIRES_PAID", 409, "canonically paid"],
    ["DISTRIBUTOR_CONFLICT", 409, "Refresh and try again"],
    ["ADMIN_REQUIRED", 403, "System Administrator"],
  ])("maps %s to its typed HTTP status and message", async (code, status, message) => {
    contextForMock.mockResolvedValue(context(true, { success: false, code }));
    const response = await POST(request(erpPayment));
    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ code, message: expect.stringContaining(message) });
  });
});
