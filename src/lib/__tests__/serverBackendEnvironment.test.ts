jest.mock("server-only", () => ({}), { virtual: true });

const createClient = jest.fn(() => ({ kind: "supabase-client" }));
const getServerBackendEnvironment = jest.fn();

jest.mock("@supabase/supabase-js", () => ({ createClient }));
jest.mock("../serverBackendIdentity", () => ({ getServerBackendEnvironment }));

import {
  backendUnavailableResponse,
  createServerAnonClient,
  createServerServiceClient,
} from "../serverBackendEnvironment";

describe("server backend client boundary", () => {
  const originalEnvironment = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnvironment };
    createClient.mockClear();
    getServerBackendEnvironment.mockReset();
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  afterAll(() => {
    process.env = originalEnvironment;
  });

  it.each(["preview", "development"])(
    "never evaluates the privileged-key accessor for %s",
    (deployment) => {
      let privilegedReads = 0;
      process.env = new Proxy(process.env, {
        get(target, property, receiver) {
          if (property === "SUPABASE_SERVICE_ROLE_KEY") privilegedReads += 1;
          return Reflect.get(target, property, receiver);
        },
      });
      getServerBackendEnvironment.mockReturnValue({
        status: "unavailable",
        deployment,
        reason: `${deployment.toUpperCase()}_BACKEND_DISABLED`,
      });
      expect(createServerAnonClient()).toEqual({ ok: false });
      expect(createServerServiceClient()).toEqual({ ok: false });
      expect(privilegedReads).toBe(0);
      expect(createClient).not.toHaveBeenCalled();
    },
  );

  it("preserves production inputs after authorization", () => {
    getServerBackendEnvironment.mockReturnValue({
      status: "configured",
      deployment: "production",
      reason: "AUTHORIZED_PRODUCTION",
      url: "https://authorized.example",
      anonKey: "public-fixture-key",
    });
    process.env.SUPABASE_SERVICE_ROLE_KEY = "server-fixture-key";
    expect(createServerAnonClient("access-token").ok).toBe(true);
    expect(createServerServiceClient().ok).toBe(true);
    expect(createClient.mock.calls[0]?.slice(0, 2)).toEqual([
      "https://authorized.example",
      "public-fixture-key",
    ]);
    expect(createClient.mock.calls[1]?.slice(0, 2)).toEqual([
      "https://authorized.example",
      "server-fixture-key",
    ]);
  });

  it("fails closed when the privileged credential is absent", () => {
    getServerBackendEnvironment.mockReturnValue({
      status: "configured",
      deployment: "production",
      reason: "AUTHORIZED_PRODUCTION",
      url: "https://authorized.example",
      anonKey: "public-fixture-key",
    });
    expect(createServerServiceClient()).toEqual({ ok: false });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("allows only an anonymous loopback client for the test fixture", () => {
    getServerBackendEnvironment.mockReturnValue({
      status: "configured",
      deployment: "test",
      reason: "AUTHORIZED_TEST_FIXTURE",
      url: "http://127.0.0.1:54321",
      anonKey: "zerodata-local-test-fixture",
    });
    expect(createServerAnonClient().ok).toBe(true);
    expect(createServerServiceClient()).toEqual({ ok: false });
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  it("returns one sanitized unavailable response", async () => {
    const response = backendUnavailableResponse();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "CRM_UNAVAILABLE" });
  });
});
