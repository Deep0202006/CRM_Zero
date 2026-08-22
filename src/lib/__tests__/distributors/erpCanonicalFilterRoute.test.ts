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

  it("fails malformed ERP filters instead of falling back to an unfiltered read", async () => {
    const response = await GET(new Request("http://localhost/api/distributors?erp=not-a-guid"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_FILTERS" });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
