import { stableErpId } from "@/lib/erp/domain";

const contextForMock = jest.fn();
const rpcMock = jest.fn();

jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/distributors/server", () => ({
  contextFor: (...args: unknown[]) => contextForMock(...args),
  apiError: (status: number, code: string, message: string) => Response.json({ code, message }, { status }),
  distributorReadError: () => Response.json({ code: "DISTRIBUTOR_SERVER_ERROR" }, { status: 503 }),
  externalViewerDenied: () => null,
}));

import { GET } from "@/app/api/distributors/route";

describe("Distributor canonical ERP filter route", () => {
  const erpId = stableErpId("MARG");

  beforeEach(() => {
    rpcMock.mockReset();
    contextForMock.mockResolvedValue({
      isAdmin: true,
      userId: "00000000-0000-4000-8000-000000000001",
      service: { rpc: rpcMock },
    });
    rpcMock.mockResolvedValue({ data: { rows: [], total: 0 }, error: null });
  });

  it("passes the exact canonical ERP ID to the bounded projection", async () => {
    const response = await GET(new Request(`http://localhost/api/distributors?erp=${erpId}`));
    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("distributor_financial_projection_v2", expect.objectContaining({ p_erp_id: erpId }));
  });

  it("passes every supported filter to the bounded server projection", async () => {
    const assignedTo = "10000000-0000-4000-8000-000000000002";
    const response = await GET(new Request(`http://localhost/api/distributors?page=2&pageSize=25&search=Alpha&assignedTo=${assignedTo}&billing=billed&paymentStatus=PAID&erpUnset=true&installation=done&training=pending&mapping=done&activity=active&renewal=due_soon`));
    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("distributor_financial_projection_v2", expect.objectContaining({
      p_page: 2,
      p_page_size: 25,
      p_search: "Alpha",
      p_assigned_to: assignedTo,
      p_billing_filter: "billed",
      p_payment_filter: "PAID",
      p_erp_unset: true,
      p_installation_filter: "done",
      p_training_filter: "pending",
      p_mapping_filter: "done",
      p_activity_filter: "active",
      p_renewal_filter: "due_soon",
    }));
  });

  it("rejects unknown filter values and oversized pages", async () => {
    for (const query of ["installation=unknown", "paymentStatus=UNKNOWN", "pageSize=51"]) {
      const response = await GET(new Request(`http://localhost/api/distributors?${query}`));
      expect(response.status).toBe(400);
    }
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("fails malformed ERP filters instead of falling back to an unfiltered read", async () => {
    const response = await GET(new Request("http://localhost/api/distributors?erp=not-a-guid"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_FILTERS" });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
