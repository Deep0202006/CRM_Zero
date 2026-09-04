jest.mock("server-only", () => ({}), { virtual: true });

const getServerBackendEnvironment = jest.fn();
jest.mock("../serverBackendIdentity", () => ({ getServerBackendEnvironment }));

import { NextRequest } from "next/server";
import { config, proxy } from "../../proxy";

describe("backend isolation proxy", () => {
  beforeEach(() => getServerBackendEnvironment.mockReset());

  it("returns a non-secret 503 for unavailable APIs regardless of request hints", async () => {
    getServerBackendEnvironment.mockReturnValue({
      status: "unavailable",
      deployment: "preview",
      reason: "NON_PRODUCTION_PRODUCTION_BACKEND_REJECTED",
    });
    const response = proxy(
      new NextRequest("https://production-looking.example/api/team-kpi?environment=production", {
        method: "POST",
        headers: { cookie: "environment=production", "x-environment": "production" },
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "BACKEND_UNAVAILABLE",
      deployment: "preview",
      reason: "NON_PRODUCTION_PRODUCTION_BACKEND_REJECTED",
    });
  });

  it("allows only the safe login page when backend is unavailable", () => {
    getServerBackendEnvironment.mockReturnValue({
      status: "unavailable",
      deployment: "preview",
      reason: "PREVIEW_BACKEND_DISABLED",
    });
    expect(proxy(new NextRequest("https://example.test/login")).headers.get("x-middleware-next")).toBe("1");
    const protectedResponse = proxy(new NextRequest("https://example.test/admin"));
    expect(protectedResponse.status).toBe(307);
    expect(protectedResponse.headers.get("location")).toBe("https://example.test/login");
  });

  it("preserves valid production routing", () => {
    getServerBackendEnvironment.mockReturnValue({
      status: "configured",
      deployment: "production",
      reason: "AUTHORIZED_PRODUCTION",
      url: "https://authorized.example",
      anonKey: "public-fixture",
    });
    expect(proxy(new NextRequest("https://example.test/admin")).headers.get("x-middleware-next")).toBe("1");
  });

  it("statically excludes framework assets and files", () => {
    expect(config.matcher).toEqual([
      "/((?!_next/static|_next/image|.*\\..*).*)",
    ]);
  });
});
