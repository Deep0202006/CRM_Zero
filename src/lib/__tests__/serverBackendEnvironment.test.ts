jest.mock("server-only", () => ({}), { virtual: true });

const createClient = jest.fn(() => ({ kind: "supabase-client" }));
const getServerBackendEnvironment = jest.fn();

jest.mock("@supabase/supabase-js", () => ({ createClient }));
jest.mock("../serverBackendIdentity", () => ({ getServerBackendEnvironment }));

import {
  createServerAnonClient,
  createServerServiceClient,
} from "../serverBackendEnvironment";

describe("server backend client boundary", () => {
  beforeEach(() => {
    createClient.mockClear();
    getServerBackendEnvironment.mockReset();
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  it("never constructs a client when backend classification is unavailable", () => {
    getServerBackendEnvironment.mockReturnValue({
      status: "unavailable",
      deployment: "preview",
      reason: "PREVIEW_BACKEND_DISABLED",
    });
    expect(createServerAnonClient("token")).toEqual({
      ok: false,
      deployment: "preview",
      reason: "PREVIEW_BACKEND_DISABLED",
    });
    expect(createServerServiceClient().ok).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("preserves production client inputs under the authorized contract", () => {
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

  it("fails closed when the server-only credential is absent", () => {
    getServerBackendEnvironment.mockReturnValue({
      status: "configured",
      deployment: "production",
      reason: "AUTHORIZED_PRODUCTION",
      url: "https://authorized.example",
      anonKey: "public-fixture-key",
    });
    expect(createServerServiceClient()).toEqual({
      ok: false,
      deployment: "production",
      reason: "MISSING_SERVICE_ROLE_CONFIGURATION",
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("allows only an anonymous client for the deterministic test fixture", () => {
    getServerBackendEnvironment.mockReturnValue({
      status: "configured",
      deployment: "test",
      reason: "AUTHORIZED_TEST_FIXTURE",
      url: "http://127.0.0.1:54321",
      anonKey: "zerodata-local-test-fixture",
    });
    expect(createServerAnonClient().ok).toBe(true);
    expect(createServerServiceClient()).toEqual({
      ok: false,
      deployment: "test",
      reason: "PRIVILEGED_CLIENT_NOT_AVAILABLE",
    });
    expect(createClient).toHaveBeenCalledTimes(1);
  });
});
